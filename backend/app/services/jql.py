"""JQL-lite: a small hand-written parser that compiles to SQLAlchemy expressions.

No eval, no raw SQL: user text is only ever bound as parameters. Grammar:

    query  := [expr] [ORDER BY item {, item}]
    expr   := and {OR and};  and := unary {AND unary};  unary := NOT unary | '(' expr ')' | cond
    cond   := field op value | field IN (v,..) | field NOT IN (v,..) | field IS [NOT] EMPTY
    op     := = != ~ !~ < <= > >=
    value  := "quoted" | word | func()   (words like -7d / 2w are relative dates for date fields)
"""
import json
import re
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import String, and_, cast, false, func, not_, or_, select, true

from ..models import (JiraColumn, JiraComponent, JiraIssue, JiraIssueComponent, JiraLink, JiraProject, JiraSprint,
                      JiraVersion, User)

MAX_LEN = 4000
MAX_DEPTH = 20
MAX_VALUES = 100
KEYWORDS = {"and", "or", "not", "in", "is", "empty", "order", "by", "asc", "desc"}


class JQLError(Exception):
    def __init__(self, msg: str, pos: int = 0):
        super().__init__(msg)
        self.msg, self.pos = msg, pos


# ------------------------------------------------------------------ tokenizer
_WORD = re.compile(r"[^\s()=!~<>,\"']+")


def tokenize(src: str) -> list[tuple]:
    """tokens: (kind, value, start, end); kind in str|word|op|lp|rp|comma"""
    toks, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c.isspace():
            i += 1
        elif c in "\"'":
            j, buf = i + 1, []
            while j < n and src[j] != c:
                if src[j] == "\\" and j + 1 < n:
                    j += 1
                buf.append(src[j])
                j += 1
            if j >= n:
                raise JQLError("Unterminated string", i)
            toks.append(("str", "".join(buf), i, j + 1))
            i = j + 1
        elif c == "(":
            toks.append(("lp", c, i, i + 1)); i += 1
        elif c == ")":
            toks.append(("rp", c, i, i + 1)); i += 1
        elif c == ",":
            toks.append(("comma", c, i, i + 1)); i += 1
        elif c in "=!~<>":
            two = src[i:i + 2]
            if two in ("!=", "!~", "<=", ">="):
                toks.append(("op", two, i, i + 2)); i += 2
            elif c in "=~<>":
                toks.append(("op", c, i, i + 1)); i += 1
            else:
                raise JQLError("Unexpected character '!'", i)
        else:
            m = _WORD.match(src, i)
            if not m:
                raise JQLError(f"Unexpected character '{c}'", i)
            toks.append(("word", m.group(), i, m.end())); i = m.end()
    return toks


# ------------------------------------------------------------------ parser
class Parser:
    def __init__(self, src: str):
        self.src = src
        self.t = tokenize(src)
        self.p = 0
        self.depth = 0

    def peek(self, k=0):
        return self.t[self.p + k] if self.p + k < len(self.t) else None

    def eof_pos(self):
        return len(self.src)

    def next(self):
        tok = self.peek()
        if tok is None:
            raise JQLError("Unexpected end of query", self.eof_pos())
        self.p += 1
        return tok

    def is_kw(self, tok, *kws):
        return tok is not None and tok[0] == "word" and tok[1].lower() in kws

    def parse(self):
        where, order = None, []
        if self.peek() is not None and not self.is_kw(self.peek(), "order"):
            where = self.expr()
        if self.is_kw(self.peek(), "order"):
            self.next()
            if not self.is_kw(self.peek(), "by"):
                raise JQLError("Expected BY after ORDER", self.peek()[2] if self.peek() else self.eof_pos())
            self.next()
            while True:
                f = self.next()
                if f[0] != "word":
                    raise JQLError("Expected a field name after ORDER BY", f[2])
                direction = "asc"
                if self.is_kw(self.peek(), "asc", "desc"):
                    direction = self.next()[1].lower()
                order.append((f[1], direction, f[2]))
                if self.peek() is not None and self.peek()[0] == "comma":
                    self.next()
                    continue
                break
        if self.peek() is not None:
            tk = self.peek()
            raise JQLError(f"Unexpected '{tk[1]}'", tk[2])
        return where, order

    def expr(self):
        self.depth += 1
        if self.depth > MAX_DEPTH:
            raise JQLError("Query is nested too deeply", self.peek()[2] if self.peek() else 0)
        node = self.and_()
        while self.is_kw(self.peek(), "or"):
            self.next()
            node = ("or", node, self.and_())
        self.depth -= 1
        return node

    def and_(self):
        node = self.unary()
        while self.is_kw(self.peek(), "and"):
            self.next()
            node = ("and", node, self.unary())
        return node

    def unary(self):
        tok = self.peek()
        if tok is None:
            raise JQLError("Unexpected end of query", self.eof_pos())
        if self.is_kw(tok, "not"):
            self.next()
            return ("not", self.unary())
        if tok[0] == "lp":
            self.next()
            node = self.expr()
            c = self.next()
            if c[0] != "rp":
                raise JQLError("Expected ')'", c[2])
            return node
        return self.cond()

    def cond(self):
        f = self.next()
        if f[0] != "word" or f[1].lower() in KEYWORDS:
            raise JQLError(f"Expected a field name, got '{f[1]}'", f[2])
        opt = self.next()
        if opt[0] == "op":
            return ("cond", f[1], opt[1], [self.value()], f[2])
        if self.is_kw(opt, "in"):
            return ("cond", f[1], "in", self.value_list(), f[2])
        if self.is_kw(opt, "not"):
            n = self.next()
            if not self.is_kw(n, "in"):
                raise JQLError("Expected IN after NOT", n[2])
            return ("cond", f[1], "not in", self.value_list(), f[2])
        if self.is_kw(opt, "is"):
            n = self.next()
            neg = False
            if self.is_kw(n, "not"):
                neg = True
                n = self.next()
            if not self.is_kw(n, "empty"):
                raise JQLError("Expected EMPTY after IS", n[2])
            return ("cond", f[1], "is not empty" if neg else "is empty", [], f[2])
        raise JQLError(f"Expected an operator after '{f[1]}'", opt[2])

    def value_list(self):
        t = self.next()
        if t[0] != "lp":  # `sprint in openSprints()` : a single value / function without parentheses
            self.p -= 1
            return [self.value()]
        vals = [self.value()]
        while self.peek() is not None and self.peek()[0] == "comma":
            self.next()
            vals.append(self.value())
            if len(vals) > MAX_VALUES:
                raise JQLError("Too many values in list", t[2])
        c = self.next()
        if c[0] != "rp":
            raise JQLError("Expected ')'", c[2])
        return vals

    def value(self):
        t = self.next()
        if t[0] == "str":
            return ("lit", t[1], t[2])
        if t[0] != "word" or t[1].lower() in KEYWORDS - {"empty"}:
            raise JQLError(f"Expected a value, got '{t[1]}'", t[2])
        nx = self.peek()
        if nx is not None and nx[0] == "lp" and nx[2] == t[3]:  # function call: name(
            self.next()
            args = []
            if self.peek() is not None and self.peek()[0] != "rp":
                args.append(self.value())
                while self.peek() is not None and self.peek()[0] == "comma":
                    self.next()
                    args.append(self.value())
            c = self.next()
            if c[0] != "rp":
                raise JQLError("Expected ')'", c[2])
            return ("func", t[1], args, t[2])
        return ("lit", t[1], t[2])


# ------------------------------------------------------------------ compiler
STATUS_CATS = {"to do": "todo", "todo": "todo", "in progress": "in_progress", "in_progress": "in_progress",
               "done": "done"}
DATE_FIELDS = {"created": JiraIssue.created_at, "updated": JiraIssue.updated_at, "resolved": JiraIssue.resolved_at,
               "due": JiraIssue.due_date, "start": JiraIssue.start_date}
_REL = re.compile(r"^([+-]?)(\d+)([hdwm])$", re.I)
_KEY = re.compile(r"^([A-Za-z0-9]+)-(\d+)$")
ORDER_FIELDS = {"created": JiraIssue.created_at, "updated": JiraIssue.updated_at, "resolved": JiraIssue.resolved_at,
                "due": JiraIssue.due_date, "rank": JiraIssue.rank, "type": JiraIssue.type,
                "title": JiraIssue.title, "summary": JiraIssue.title, "storypoints": JiraIssue.story_points,
                "start": JiraIssue.start_date}


def _now():
    return datetime.now(timezone.utc)


class Compiler:
    def __init__(self, db, user):
        self.db, self.user = db, user

    # -- values
    def lit(self, v) -> str:
        """Value -> plain string for non-date fields."""
        if v[0] == "lit":
            return v[1]
        name = v[1].lower()
        if name == "currentuser":
            return str(self.user.id)
        raise JQLError(f"Function {v[1]}() is not valid here", v[3])

    def when(self, v, field: str):
        """Value -> (datetime, date_only)"""
        if v[0] == "func":
            name = v[1].lower()
            base = _now()
            delta = timedelta()
            if v[2]:
                delta = self._rel(v[2][0], v[3])
            if name == "now":
                return base + delta, False
            if name in ("startofday", "today"):
                return base.replace(hour=0, minute=0, second=0, microsecond=0) + delta, False
            if name == "startofweek":
                d = base.replace(hour=0, minute=0, second=0, microsecond=0)
                return d - timedelta(days=d.weekday()) + delta, False
            if name == "startofmonth":
                return base.replace(day=1, hour=0, minute=0, second=0, microsecond=0) + delta, False
            raise JQLError(f"Function {v[1]}() is not valid for date fields", v[3])
        s = v[1].strip()
        if _REL.match(s):
            return _now() + self._rel(v, v[2]), False
        try:
            if len(s) == 10:
                d = datetime.strptime(s, "%Y-%m-%d")
                return d.replace(tzinfo=timezone.utc), True
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)), False
        except ValueError:
            raise JQLError(f"Invalid date '{s}' (use YYYY-MM-DD, -7d, now(), startOfDay())", v[2])

    def _rel(self, v, pos) -> timedelta:
        m = _REL.match(v[1].strip()) if v[0] == "lit" else None
        if not m:
            raise JQLError("Expected a relative date like -7d, -2w or 3h", pos)
        n = int(m.group(2)) * (-1 if m.group(1) == "-" else 1)
        unit = m.group(3).lower()
        return {"h": timedelta(hours=n), "d": timedelta(days=n), "w": timedelta(weeks=n),
                "m": timedelta(days=30 * n)}[unit]

    # -- tree
    def node(self, n):
        k = n[0]
        if k == "and":
            return and_(self.node(n[1]), self.node(n[2]))
        if k == "or":
            return or_(self.node(n[1]), self.node(n[2]))
        if k == "not":
            return not_(self.node(n[1]))
        return self.cond(n)

    def issue_ids_for_key(self, s: str, pos: int):
        m = _KEY.match(s.strip())
        if not m:
            raise JQLError(f"'{s}' is not an issue key like TF-12", pos)
        return and_(JiraIssue.project_id.in_(select(JiraProject.id).where(JiraProject.key == m.group(1).upper())),
                    JiraIssue.number == int(m.group(2)))

    def cond(self, n):
        _, field, op, vals, pos = n
        f = field.lower()
        # text search
        if f in ("text", "summary", "title", "description"):
            if op not in ("~", "!~", "=", "!=", "is empty", "is not empty", "in", "not in"):
                raise JQLError(f"Operator {op} is not supported for {field}", pos)
            cols = {"text": [JiraIssue.title, JiraIssue.description], "summary": [JiraIssue.title],
                    "title": [JiraIssue.title], "description": [JiraIssue.description]}[f]
            if op in ("is empty", "is not empty"):
                e = and_(*[or_(c.is_(None), c == "") for c in cols])
                return e if op == "is empty" else not_(e)
            strs = [self.lit(v).lower() for v in vals]
            if op in ("~", "!~"):
                pos_c = or_(*[func.lower(c).contains(s, autoescape=True) for c in cols for s in strs])
            else:
                pos_c = or_(*[func.lower(c) == s for c in cols for s in strs])
            neg = op in ("!~", "!=", "not in")
            return not_(func.coalesce(pos_c, false())) if neg else pos_c
        if f in DATE_FIELDS:
            return self.date_cond(f, op, vals, pos)
        if f in ("flagged", "blocked"):
            if op not in ("=", "!="):
                raise JQLError(f"Operator {op} is not supported for {field}", pos)
            s = self.lit(vals[0]).lower()
            if s not in ("true", "false", "yes", "no", "1", "0"):
                raise JQLError(f"{field} must be true or false", vals[0][2])
            want = s in ("true", "yes", "1")
            if op == "!=":
                want = not want
            if f == "flagged":
                c = JiraIssue.flagged == true()
            else:
                c = JiraIssue.id.in_(self.blocked_subq())
            return c if want else not_(c)
        if f == "storypoints":
            return self.num_cond(JiraIssue.story_points, op, vals, pos)
        pos_c, empty_c = self.membership(f, field, vals, pos)
        if op in ("=", "in"):
            return pos_c
        if op in ("!=", "not in"):
            return or_(empty_c, not_(pos_c))
        if op == "is empty":
            return empty_c
        if op == "is not empty":
            return not_(empty_c)
        raise JQLError(f"Operator {op} is not supported for {field}", pos)

    def num_cond(self, col, op, vals, pos):
        if op in ("is empty", "is not empty"):
            return col.is_(None) if op == "is empty" else col.is_not(None)
        try:
            nums = [float(self.lit(v)) for v in vals]
        except ValueError:
            raise JQLError("Expected a number", pos)
        ops = {"=": col == nums[0], "!=": col != nums[0], "<": col < nums[0], "<=": col <= nums[0],
               ">": col > nums[0], ">=": col >= nums[0], "in": col.in_(nums), "not in": col.not_in(nums)}
        if op not in ops:
            raise JQLError(f"Operator {op} is not supported here", pos)
        return ops[op]

    def date_cond(self, f, op, vals, pos):
        col = DATE_FIELDS[f]
        if op in ("is empty", "is not empty"):
            return col.is_(None) if op == "is empty" else col.is_not(None)
        if op in ("~", "!~", "in", "not in"):
            raise JQLError(f"Operator {op} is not supported for {f}", pos)
        dt, date_only = self.when(vals[0], f)
        is_date_col = f in ("due", "start")
        lo, hi = dt, dt + timedelta(days=1)
        if is_date_col:
            lo_v, hi_v, v = lo.date(), hi.date(), dt.date()
        else:
            lo_v, hi_v, v = lo, hi, dt
        if op == "=":
            return and_(col >= lo_v, col < hi_v) if (date_only and not is_date_col) else col == v
        if op == "!=":
            return or_(col.is_(None), col < lo_v, col >= hi_v) if (date_only and not is_date_col) else \
                or_(col.is_(None), col != v)
        if op == "<":
            return col < v
        if op == ">":
            return col >= hi_v if (date_only and not is_date_col) else col > v
        if op == "<=":
            return col < hi_v if (date_only and not is_date_col) else col <= v
        if op == ">=":
            return col >= v
        raise JQLError(f"Operator {op} is not supported for {f}", pos)

    def blocked_subq(self):
        blocker = JiraIssue.__table__.alias("blocker")
        col = JiraColumn.__table__.alias("bcol")
        return (select(JiraLink.target_id).join(blocker, blocker.c.id == JiraLink.source_id)
                .join(col, col.c.id == blocker.c.column_id)
                .where(JiraLink.link_type == "blocks", col.c.category != "done"))

    def membership(self, f, field, vals, pos):
        """Return (positive_clause_for_any_of_vals, empty_clause)."""
        if f == "project":
            keys = [self.lit(v).upper() for v in vals]
            return (JiraIssue.project_id.in_(select(JiraProject.id).where(JiraProject.key.in_(keys))),
                    false())
        if f == "key":
            return or_(*[self.issue_ids_for_key(self.lit(v), v[2]) for v in vals]), false()
        if f == "type":
            return func.lower(JiraIssue.type).in_([self.lit(v).lower() for v in vals]), false()
        if f == "priority":
            return func.lower(JiraIssue.priority).in_([self.lit(v).lower() for v in vals]), false()
        if f == "status":
            return (JiraIssue.column_id.in_(select(JiraColumn.id).where(
                func.lower(JiraColumn.name).in_([self.lit(v).lower() for v in vals]))), false())
        if f == "statuscategory":
            cats = []
            for v in vals:
                s = self.lit(v).lower()
                if s not in STATUS_CATS:
                    raise JQLError(f"Unknown status category '{s}' (use To Do, In Progress, Done)", v[2])
                cats.append(STATUS_CATS[s])
            return (JiraIssue.column_id.in_(select(JiraColumn.id).where(JiraColumn.category.in_(cats))), false())
        if f in ("assignee", "reporter"):
            col = JiraIssue.assignee_id if f == "assignee" else JiraIssue.reporter_id
            ids, names = [], []
            for v in vals:
                s = self.lit(v)
                if v[0] == "func" or s.isdigit():
                    ids.append(int(s))
                else:
                    names.append(s.lower())
            conds = []
            if ids:
                conds.append(col.in_(ids))
            if names:
                conds.append(col.in_(select(User.id).where(or_(func.lower(User.email).in_(names),
                                                               func.lower(User.name).in_(names)))))
            return or_(*conds), col.is_(None)
        if f in ("label", "labels"):
            lab = cast(JiraIssue.labels, String)
            conds = [lab.contains(json.dumps(self.lit(v)), autoescape=True) for v in vals]
            return or_(*conds), or_(JiraIssue.labels.is_(None), lab == "[]")
        if f == "sprint":
            conds = []
            names = []
            for v in vals:
                if v[0] == "func":
                    nm = v[1].lower()
                    if nm == "opensprints":
                        conds.append(JiraIssue.sprint_id.in_(select(JiraSprint.id).where(JiraSprint.state == "active")))
                    elif nm == "closedsprints":
                        conds.append(JiraIssue.sprint_id.in_(select(JiraSprint.id).where(JiraSprint.state == "closed")))
                    elif nm == "futuresprints":
                        conds.append(JiraIssue.sprint_id.in_(select(JiraSprint.id).where(JiraSprint.state == "planned")))
                    else:
                        raise JQLError(f"Function {v[1]}() is not valid for sprint", v[3])
                else:
                    names.append(v[1].lower())
            if names:
                conds.append(JiraIssue.sprint_id.in_(select(JiraSprint.id).where(
                    func.lower(JiraSprint.name).in_(names))))
            return or_(*conds), JiraIssue.sprint_id.is_(None)
        if f == "component":
            ids = select(JiraIssueComponent.issue_id).join(
                JiraComponent, JiraComponent.id == JiraIssueComponent.component_id).where(
                func.lower(JiraComponent.name).in_([self.lit(v).lower() for v in vals]))
            return (JiraIssue.id.in_(ids),
                    not_(JiraIssue.id.in_(select(JiraIssueComponent.issue_id))))
        if f in ("fixversion", "version"):
            return (JiraIssue.fix_version_id.in_(select(JiraVersion.id).where(
                func.lower(JiraVersion.name).in_([self.lit(v).lower() for v in vals]))),
                    JiraIssue.fix_version_id.is_(None))
        if f in ("parent", "epic"):
            conds = []
            for v in vals:
                conds.append(JiraIssue.parent_id.in_(select(JiraIssue.id).where(
                    self.issue_ids_for_key(self.lit(v), v[2]))))
            return or_(*conds), JiraIssue.parent_id.is_(None)
        raise JQLError(f"Unknown field '{field}'", pos)

    def order(self, items):
        out = []
        for name, direction, pos in items:
            f = name.lower()
            asc = direction == "asc"
            if f == "key":
                cols = [JiraIssue.project_id, JiraIssue.number]
            elif f == "priority":
                from .jira import PRIORITY_ORDER
                from sqlalchemy import case
                cols = [case(*[(JiraIssue.priority == k, v) for k, v in PRIORITY_ORDER.items()], else_=9)]
            elif f == "status":
                cols = [select(JiraColumn.position).where(JiraColumn.id == JiraIssue.column_id).scalar_subquery()]
            elif f in ORDER_FIELDS:
                cols = [ORDER_FIELDS[f]]
            else:
                raise JQLError(f"Cannot order by '{name}'", pos)
            for c in cols:
                if f in ("due", "start", "resolved", "storypoints"):
                    out.append(c.is_(None))  # NULLs last, portable across SQLite/Postgres
                out.append(c.asc() if asc else c.desc())
        return out


def apply_jql(db, user, query, jql: str | None):
    """Return (query filtered by jql, [order_by clauses]); raises HTTPException(422) on bad JQL."""
    if not jql or not jql.strip():
        return query, []
    if len(jql) > MAX_LEN:
        raise HTTPException(422, f"JQL is too long (max {MAX_LEN} characters)")
    try:
        where, order = Parser(jql).parse()
        comp = Compiler(db, user)
        if where is not None:
            query = query.filter(comp.node(where))
        return query, comp.order(order)
    except JQLError as e:
        raise HTTPException(422, f"{e.msg} (at position {e.pos})")


def validate(jql: str):
    """Syntax-check only (used when saving filters). Raises HTTPException(422)."""
    if len(jql or "") > MAX_LEN:
        raise HTTPException(422, f"JQL is too long (max {MAX_LEN} characters)")
    try:
        Parser(jql or "").parse()
    except JQLError as e:
        raise HTTPException(422, f"{e.msg} (at position {e.pos})")
