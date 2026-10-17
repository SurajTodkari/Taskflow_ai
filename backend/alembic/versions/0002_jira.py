"""jira-style projects, issues, sprints

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def _ts():
    return [sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False)]


def upgrade():
    op.create_table('jira_projects',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('key', sa.String(length=10), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('lead_id', sa.Integer(), nullable=True),
    sa.Column('issue_seq', sa.Integer(), nullable=False),
    *_ts(),
    sa.ForeignKeyConstraint(['lead_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('jira_projects', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_jira_projects_key'), ['key'], unique=True)

    op.create_table('jira_members',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('project_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('role', sa.String(length=10), nullable=False),
    *_ts(),
    sa.ForeignKeyConstraint(['project_id'], ['jira_projects.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'user_id', name='uq_jira_member')
    )
    with op.batch_alter_table('jira_members', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_jira_members_project_id'), ['project_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_jira_members_user_id'), ['user_id'], unique=False)

    op.create_table('jira_columns',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('project_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=60), nullable=False),
    sa.Column('category', sa.String(length=15), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    *_ts(),
    sa.ForeignKeyConstraint(['project_id'], ['jira_projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('jira_columns', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_jira_columns_project_id'), ['project_id'], unique=False)

    op.create_table('jira_sprints',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('project_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('goal', sa.Text(), nullable=True),
    sa.Column('state', sa.String(length=10), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=True),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    *_ts(),
    sa.ForeignKeyConstraint(['project_id'], ['jira_projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('jira_sprints', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_jira_sprints_project_id'), ['project_id'], unique=False)

    op.create_table('jira_issues',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('project_id', sa.Integer(), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('type', sa.String(length=10), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('column_id', sa.Integer(), nullable=False),
    sa.Column('priority', sa.String(length=10), nullable=False),
    sa.Column('assignee_id', sa.Integer(), nullable=True),
    sa.Column('reporter_id', sa.Integer(), nullable=True),
    sa.Column('parent_id', sa.Integer(), nullable=True),
    sa.Column('sprint_id', sa.Integer(), nullable=True),
    sa.Column('story_points', sa.Integer(), nullable=True),
    sa.Column('labels', sa.JSON(), nullable=False),
    sa.Column('due_date', sa.Date(), nullable=True),
    sa.Column('rank', sa.Float(), nullable=False),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    *_ts(),
    sa.ForeignKeyConstraint(['project_id'], ['jira_projects.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['column_id'], ['jira_columns.id']),
    sa.ForeignKeyConstraint(['assignee_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['reporter_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['parent_id'], ['jira_issues.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['sprint_id'], ['jira_sprints.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'number', name='uq_jira_issue_number')
    )
    with op.batch_alter_table('jira_issues', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_jira_issues_project_id'), ['project_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_jira_issues_column_id'), ['column_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_jira_issues_assignee_id'), ['assignee_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_jira_issues_parent_id'), ['parent_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_jira_issues_sprint_id'), ['sprint_id'], unique=False)

    op.create_table('jira_comments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('issue_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    *_ts(),
    sa.ForeignKeyConstraint(['issue_id'], ['jira_issues.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('jira_comments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_jira_comments_issue_id'), ['issue_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_jira_comments_user_id'), ['user_id'], unique=False)

    op.create_table('jira_history',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('issue_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('field', sa.String(length=40), nullable=False),
    sa.Column('old_value', sa.Text(), nullable=True),
    sa.Column('new_value', sa.Text(), nullable=True),
    *_ts(),
    sa.ForeignKeyConstraint(['issue_id'], ['jira_issues.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('jira_history', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_jira_history_issue_id'), ['issue_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_jira_history_user_id'), ['user_id'], unique=False)


def downgrade():
    for t in ('jira_history', 'jira_comments', 'jira_issues', 'jira_sprints', 'jira_columns',
              'jira_members', 'jira_projects'):
        op.drop_table(t)
