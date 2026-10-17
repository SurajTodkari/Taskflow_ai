import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { CalendarDays, Bell, BarChart3, Sparkles, KanbanSquare, RefreshCcw, FileText, ShieldCheck, ArrowRight, CheckCircle2, Check, Zap, Clock, Flame } from 'lucide-react';
import Logo from '../components/brand/Logo';

const FEATURES = [
  { icon: RefreshCcw, c: 'from-sky-400 to-blue-600', title: 'Automatic carry-forward', text: 'Unfinished work rolls into the next day without ever rewriting your original deadline or history.' },
  { icon: Bell, c: 'from-amber-400 to-orange-500', title: 'Smart reminders', text: 'Morning plan, task reminders, evening summary and overdue alerts, in-app and via Web Push.' },
  { icon: CalendarDays, c: 'from-emerald-400 to-teal-600', title: 'Plan weeks ahead', text: 'Day, week, month and year calendar with drag-and-drop rescheduling and recurring tasks.' },
  { icon: KanbanSquare, c: 'from-violet-400 to-purple-600', title: 'Projects and Kanban', text: 'Milestones, progress tracking and a Backlog to Completed board for every project.' },
  { icon: BarChart3, c: 'from-cyan-400 to-blue-500', title: 'Real analytics', text: 'Productivity, workload, overdue trends and time tracking from your stored data.' },
  { icon: Sparkles, c: 'from-fuchsia-400 to-pink-600', title: 'AI assistant', text: 'Ask what is pending for tomorrow. Answers come from your real tasks, never invented ones.' },
  { icon: FileText, c: 'from-indigo-400 to-blue-700', title: 'Daily reports', text: 'An automatic end-of-day report you can revisit by date and export as PDF or CSV.' },
  { icon: ShieldCheck, c: 'from-rose-400 to-red-600', title: 'Private by design', text: 'JWT authentication, per-user data isolation, rate limiting and environment-based secrets.' },
];
const STEPS = [
  ['Capture', 'Add tasks for today or any date weeks and months ahead.', 'from-sky-400 to-blue-600'],
  ['Focus', 'Open the dashboard: today, what is carried over, and what is overdue.', 'from-violet-400 to-purple-600'],
  ['Review', "Get an evening summary and tomorrow's plan before you close your laptop.", 'from-emerald-400 to-teal-600'],
];
const FACTS = [['4', 'calendar views'], ['5', 'Kanban stages'], ['12', 'connected workspaces'], ['2', 'themes: light and dark']];

const fade = (reduce: boolean | null, delay = 0) => reduce ? {} : { initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-60px' }, transition: { duration: .55, delay, ease: [.2, .8, .2, 1] as const } };
const float = (reduce: boolean | null, d = 0) => reduce ? {} : { animate: { y: [0, -10, 0] }, transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' as const, delay: d } };

export default function Landing() {
  const reduce = useReducedMotion();
  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-[#0B1B3F]">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#050F2C]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Logo size={34} light />
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-300 md:flex" aria-label="Main">
            <a href="#features" className="transition hover:text-white">Features</a>
            <a href="#how" className="transition hover:text-white">How it works</a>
            <a href="#notify" className="transition hover:text-white">Notifications</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">Sign in</Link>
            <Link to="/register" className="rounded-lg bg-gradient-to-r from-sky-400 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-600/40 transition hover:brightness-110">Get started</Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden bg-[#050F2C] text-white">
        <div className="pointer-events-none absolute inset-0 opacity-[.18]" style={{ backgroundImage: 'radial-gradient(#7dd3fc 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        <motion.div className="pointer-events-none absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-blue-600/40 blur-[110px]" {...(reduce ? {} : { animate: { scale: [1, 1.15, 1] }, transition: { duration: 9, repeat: Infinity } })} />
        <motion.div className="pointer-events-none absolute -bottom-48 right-[-6rem] h-[36rem] w-[36rem] rounded-full bg-violet-600/35 blur-[120px]" {...(reduce ? {} : { animate: { scale: [1.1, 1, 1.1] }, transition: { duration: 11, repeat: Infinity } })} />
        <div className="pointer-events-none absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-400/20 blur-[100px]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 py-20 lg:grid-cols-[1.05fr_1fr] lg:py-28">
          <motion.div {...fade(reduce)}>
            <span className="inline-flex items-center gap-2 rounded-full border border-sky-300/30 bg-sky-400/10 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-sky-200"><Sparkles size={14} />TaskFlow AI by Nexora AI Research Centre</span>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl">Know what to do today.<br /><span className="bg-gradient-to-r from-sky-300 via-blue-400 to-violet-400 bg-clip-text text-transparent">Prepare for tomorrow.</span></h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">One calm command center for your daily work. See today's tasks, what is still pending from yesterday, and what is next, with reminders that reach you on your screen.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link to="/register" className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 via-blue-500 to-violet-500 px-7 py-3.5 font-semibold text-white shadow-xl shadow-blue-500/40 transition hover:brightness-110">Start free <ArrowRight size={18} className="transition group-hover:translate-x-1" /></Link>
              <Link to="/login" className="rounded-xl border border-white/25 bg-white/5 px-7 py-3.5 font-semibold text-white backdrop-blur transition hover:bg-white/15">Sign in</Link>
            </div>
            <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-300">
              {['Built on your real data', 'Light and dark themes', 'Laptop and mobile ready'].map((t) => <li key={t} className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-400" />{t}</li>)}
            </ul>
          </motion.div>

          <motion.div {...fade(reduce, .15)} className="relative" aria-hidden="true">
            <motion.div {...float(reduce)} className="relative rounded-3xl border border-white/20 bg-white/10 p-3 shadow-2xl shadow-blue-900/50 backdrop-blur-xl">
              <div className="rounded-2xl bg-white p-5 text-[#0B1B3F]">
                <div className="flex items-center justify-between"><div><p className="text-xs text-slate-500">Today</p><p className="text-lg font-bold">My Today's Work</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">Preview</span></div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {[['4', 'Tasks', 'from-sky-500 to-blue-600'], ['2', 'Done', 'from-emerald-500 to-teal-600'], ['50%', 'Score', 'from-violet-500 to-purple-600']].map(([v, l, c]) => (
                    <div key={l} className={`rounded-xl bg-gradient-to-br ${c} py-2.5 text-white`}><p className="text-lg font-extrabold leading-none">{v}</p><p className="mt-1 text-[11px] opacity-90">{l}</p></div>
                  ))}
                </div>
                <div className="mt-4 space-y-2">
                  {[['Review pull requests', 'High', 'bg-red-100 text-red-600', true], ['Prepare sprint plan', 'Medium', 'bg-amber-100 text-amber-700', true], ['Client call at 4:00 pm', 'High', 'bg-red-100 text-red-600', false], ['Weekly report', 'Low', 'bg-emerald-100 text-emerald-700', false]].map(([t, p, pc, d]) => (
                    <div key={String(t)} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${d ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>{d && <Check size={12} />}</span>
                      <span className={`flex-1 text-sm font-medium ${d ? 'text-slate-400 line-through' : ''}`}>{String(t)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${pc}`}>{String(p)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-1/2 rounded-full bg-gradient-to-r from-sky-400 via-blue-500 to-violet-500" /></div>
              </div>
            </motion.div>
            <motion.div {...float(reduce, 1)} className="absolute -right-3 -top-5 hidden items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#0B1B3F] shadow-xl sm:flex"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600"><Clock size={16} /></span>Starts in 15 min</motion.div>
            <motion.div {...float(reduce, 2)} className="absolute -bottom-5 right-4 hidden items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#0B1B3F] shadow-xl sm:flex"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600"><Flame size={16} /></span>Streak on track</motion.div>
          </motion.div>
        </div>
        <div className="relative border-t border-white/10 bg-white/[.04]">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-4 py-7 md:grid-cols-4">
            {FACTS.map(([n, l]) => <div key={l} className="text-center"><p className="bg-gradient-to-r from-sky-300 to-violet-300 bg-clip-text text-3xl font-extrabold text-transparent">{n}</p><p className="mt-1 text-sm text-slate-300">{l}</p></div>)}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="relative scroll-mt-20 bg-gradient-to-b from-white via-sky-50 to-white px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <motion.div {...fade(reduce)} className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold uppercase tracking-widest text-blue-700"><Zap size={13} />Features</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-5xl">Everything to run your day, <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">nothing you don't need</span></h2>
          </motion.div>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => (
              <motion.div key={f.title} {...fade(reduce, i * .04)} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 transition duration-300 hover:-translate-y-1.5 hover:border-transparent hover:shadow-2xl hover:shadow-blue-500/15">
                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${f.c}`} />
                <span className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${f.c} text-white shadow-lg transition group-hover:scale-110`}><f.icon size={24} /></span>
                <h3 className="mt-5 text-lg font-bold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW */}
      <section id="how" className="scroll-mt-20 bg-[#050F2C] px-4 py-24 text-white">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-5xl">Three steps, <span className="bg-gradient-to-r from-sky-300 to-violet-400 bg-clip-text text-transparent">every day</span></h2>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {STEPS.map(([t, d, c], i) => (
              <motion.div key={t} {...fade(reduce, i * .1)} className="relative rounded-2xl border border-white/10 bg-white/[.06] p-7 backdrop-blur transition hover:bg-white/10">
                <span className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${c} text-xl font-extrabold shadow-lg`}>{i + 1}</span>
                <h3 className="mt-5 text-xl font-bold">{t}</h3><p className="mt-2 leading-relaxed text-slate-300">{d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* NOTIFICATIONS */}
      <section id="notify" className="scroll-mt-20 bg-gradient-to-br from-sky-50 via-white to-violet-50 px-4 py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          <motion.div {...fade(reduce)}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-widest text-amber-700"><Bell size={13} />Notifications</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">Reminders where you <span className="bg-gradient-to-r from-amber-500 to-rose-500 bg-clip-text text-transparent">will see them</span></h2>
            <p className="mt-5 leading-relaxed text-slate-600">Get a morning overview, reminders before tasks start, an evening summary and a heads-up for tomorrow. Alerts live in your in-app notification center, and Web Push can reach your desktop or phone when the tab is closed.</p>
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Operating-system delivery depends on your browser, device and permissions, so it cannot be guaranteed on every platform.</p>
          </motion.div>
          <motion.div {...fade(reduce, .1)} className="space-y-3" aria-hidden="true">
            {[['Good Morning!', 'You have 8 tasks scheduled for today.', 'from-amber-400 to-orange-500'], ['Starting in 15 minutes', 'Complete Dashboard API', 'from-sky-400 to-blue-600'], ["Today's summary", 'Completed 7 of 10 tasks. 3 carried to tomorrow.', 'from-emerald-400 to-teal-600']].map(([t, d, c]) => (
              <div key={t} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/60">
                <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${c} text-white`}><Bell size={19} /></span>
                <div><p className="font-semibold">{t}</p><p className="text-sm text-slate-600">{d}</p></div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-20">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-[#050F2C] via-blue-700 to-violet-600 p-10 text-center text-white sm:p-16">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-cyan-300/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-fuchsia-400/25 blur-3xl" />
          <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-5xl">Start your next day prepared</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-lg text-blue-100">Create your account and plan the work ahead in under a minute.</p>
          <Link to="/register" className="group relative mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-8 py-3.5 font-bold text-blue-700 shadow-xl transition hover:scale-105">Create free account <ArrowRight size={18} className="transition group-hover:translate-x-1" /></Link>
        </div>
      </section>

      <footer className="bg-[#050F2C] py-10 text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row">
          <Logo size={36} tagline light />
          <p className="text-sm text-slate-400">Researching intelligence. Engineering the Future.</p>
        </div>
      </footer>
    </div>
  );
}
