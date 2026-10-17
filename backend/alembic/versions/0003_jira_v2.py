"""jira v2: invites, links, watchers, components, versions, worklogs, attachments, filters, workflow, custom fields

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def _ts():
    return [sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False)]


def _pk_fk():
    return sa.Column('project_id', sa.Integer(), sa.ForeignKey('jira_projects.id', ondelete='CASCADE'),
                     nullable=False)


def _issue_fk(name='issue_id'):
    return sa.Column(name, sa.Integer(), sa.ForeignKey('jira_issues.id', ondelete='CASCADE'), nullable=False)


def _user_fk(name='user_id', nullable=False, ondelete='CASCADE'):
    return sa.Column(name, sa.Integer(), sa.ForeignKey('users.id', ondelete=ondelete), nullable=nullable)


def upgrade():
    op.create_table('jira_invites',
                    sa.Column('id', sa.Integer(), primary_key=True), _pk_fk(),
                    sa.Column('email', sa.String(255), nullable=False),
                    sa.Column('role', sa.String(10), nullable=False),
                    _user_fk('invited_by', True, 'SET NULL'), *_ts(),
                    sa.UniqueConstraint('project_id', 'email', name='uq_jira_invite'))
    op.create_index('ix_jira_invites_project_id', 'jira_invites', ['project_id'])
    op.create_index('ix_jira_invites_email', 'jira_invites', ['email'])

    op.create_table('jira_versions',
                    sa.Column('id', sa.Integer(), primary_key=True), _pk_fk(),
                    sa.Column('name', sa.String(60), nullable=False),
                    sa.Column('description', sa.Text(), nullable=True),
                    sa.Column('start_date', sa.Date(), nullable=True),
                    sa.Column('release_date', sa.Date(), nullable=True),
                    sa.Column('released', sa.Boolean(), nullable=False, server_default=sa.false()),
                    sa.Column('released_at', sa.DateTime(timezone=True), nullable=True), *_ts(),
                    sa.UniqueConstraint('project_id', 'name', name='uq_jira_version_name'))
    op.create_index('ix_jira_versions_project_id', 'jira_versions', ['project_id'])

    op.create_table('jira_components',
                    sa.Column('id', sa.Integer(), primary_key=True), _pk_fk(),
                    sa.Column('name', sa.String(60), nullable=False),
                    sa.Column('description', sa.Text(), nullable=True),
                    _user_fk('lead_id', True, 'SET NULL'), *_ts(),
                    sa.UniqueConstraint('project_id', 'name', name='uq_jira_component_name'))
    op.create_index('ix_jira_components_project_id', 'jira_components', ['project_id'])

    # new columns on existing tables (batch mode keeps SQLite working)
    with op.batch_alter_table('user_preferences') as b:
        b.add_column(sa.Column('jira_email_notifications', sa.Boolean(), nullable=False, server_default=sa.true()))
    with op.batch_alter_table('jira_projects') as b:
        b.add_column(sa.Column('board_type', sa.String(10), nullable=False, server_default='scrum'))
        b.add_column(sa.Column('enforce_workflow', sa.Boolean(), nullable=False, server_default=sa.false()))
        b.add_column(sa.Column('default_assignee_id', sa.Integer(), nullable=True))
        b.add_column(sa.Column('archived', sa.Boolean(), nullable=False, server_default=sa.false()))
        b.create_foreign_key('fk_jira_projects_default_assignee', 'users', ['default_assignee_id'], ['id'],
                             ondelete='SET NULL')
    with op.batch_alter_table('jira_columns') as b:
        b.add_column(sa.Column('wip_limit', sa.Integer(), nullable=True))
    with op.batch_alter_table('jira_issues') as b:
        b.add_column(sa.Column('start_date', sa.Date(), nullable=True))
        b.add_column(sa.Column('original_estimate_min', sa.Integer(), nullable=True))
        b.add_column(sa.Column('remaining_estimate_min', sa.Integer(), nullable=True))
        b.add_column(sa.Column('flagged', sa.Boolean(), nullable=False, server_default=sa.false()))
        b.add_column(sa.Column('archived', sa.Boolean(), nullable=False, server_default=sa.false()))
        b.add_column(sa.Column('fix_version_id', sa.Integer(), nullable=True))
        b.add_column(sa.Column('custom_fields', sa.JSON(), nullable=False, server_default='{}'))
        b.add_column(sa.Column('environment', sa.Text(), nullable=True))
        b.create_foreign_key('fk_jira_issues_fix_version', 'jira_versions', ['fix_version_id'], ['id'],
                             ondelete='SET NULL')
        b.create_index('ix_jira_issues_fix_version_id', ['fix_version_id'])

    op.create_table('jira_issue_components',
                    sa.Column('issue_id', sa.Integer(), sa.ForeignKey('jira_issues.id', ondelete='CASCADE'),
                              primary_key=True),
                    sa.Column('component_id', sa.Integer(),
                              sa.ForeignKey('jira_components.id', ondelete='CASCADE'), primary_key=True))

    op.create_table('jira_links',
                    sa.Column('id', sa.Integer(), primary_key=True), _issue_fk('source_id'), _issue_fk('target_id'),
                    sa.Column('link_type', sa.String(15), nullable=False),
                    _user_fk('created_by', True, 'SET NULL'), *_ts(),
                    sa.UniqueConstraint('source_id', 'target_id', 'link_type', name='uq_jira_link'))
    op.create_index('ix_jira_links_source_id', 'jira_links', ['source_id'])
    op.create_index('ix_jira_links_target_id', 'jira_links', ['target_id'])

    op.create_table('jira_watchers',
                    sa.Column('id', sa.Integer(), primary_key=True), _issue_fk(), _user_fk(), *_ts(),
                    sa.UniqueConstraint('issue_id', 'user_id', name='uq_jira_watcher'))
    op.create_index('ix_jira_watchers_issue_id', 'jira_watchers', ['issue_id'])
    op.create_index('ix_jira_watchers_user_id', 'jira_watchers', ['user_id'])

    op.create_table('jira_worklogs',
                    sa.Column('id', sa.Integer(), primary_key=True), _issue_fk(), _user_fk(),
                    sa.Column('seconds', sa.Integer(), nullable=False),
                    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
                    sa.Column('comment', sa.Text(), nullable=True), *_ts())
    op.create_index('ix_jira_worklogs_issue_id', 'jira_worklogs', ['issue_id'])
    op.create_index('ix_jira_worklogs_user_id', 'jira_worklogs', ['user_id'])

    op.create_table('jira_attachments',
                    sa.Column('id', sa.Integer(), primary_key=True), _issue_fk(), _user_fk(),
                    sa.Column('filename', sa.String(255), nullable=False),
                    sa.Column('content_type', sa.String(100), nullable=False),
                    sa.Column('size', sa.Integer(), nullable=False),
                    sa.Column('data', sa.LargeBinary(), nullable=False), *_ts())
    op.create_index('ix_jira_attachments_issue_id', 'jira_attachments', ['issue_id'])
    op.create_index('ix_jira_attachments_user_id', 'jira_attachments', ['user_id'])

    op.create_table('jira_filters',
                    sa.Column('id', sa.Integer(), primary_key=True), _user_fk('owner_id'),
                    sa.Column('name', sa.String(120), nullable=False),
                    sa.Column('jql', sa.Text(), nullable=False),
                    sa.Column('shared', sa.Boolean(), nullable=False, server_default=sa.false()),
                    sa.Column('project_id', sa.Integer(), sa.ForeignKey('jira_projects.id', ondelete='CASCADE'),
                              nullable=True), *_ts())
    op.create_index('ix_jira_filters_owner_id', 'jira_filters', ['owner_id'])
    op.create_index('ix_jira_filters_project_id', 'jira_filters', ['project_id'])

    op.create_table('jira_transitions',
                    sa.Column('id', sa.Integer(), primary_key=True), _pk_fk(),
                    sa.Column('from_column_id', sa.Integer(), sa.ForeignKey('jira_columns.id', ondelete='CASCADE'),
                              nullable=False),
                    sa.Column('to_column_id', sa.Integer(), sa.ForeignKey('jira_columns.id', ondelete='CASCADE'),
                              nullable=False),
                    sa.UniqueConstraint('project_id', 'from_column_id', 'to_column_id', name='uq_jira_transition'))
    op.create_index('ix_jira_transitions_project_id', 'jira_transitions', ['project_id'])

    op.create_table('jira_custom_fields',
                    sa.Column('id', sa.Integer(), primary_key=True), _pk_fk(),
                    sa.Column('name', sa.String(60), nullable=False),
                    sa.Column('field_type', sa.String(10), nullable=False),
                    sa.Column('options', sa.JSON(), nullable=False, server_default='[]'),
                    sa.Column('required', sa.Boolean(), nullable=False, server_default=sa.false()),
                    sa.Column('position', sa.Integer(), nullable=False, server_default='0'), *_ts())
    op.create_index('ix_jira_custom_fields_project_id', 'jira_custom_fields', ['project_id'])


def downgrade():
    for t in ('jira_custom_fields', 'jira_transitions', 'jira_filters', 'jira_attachments', 'jira_worklogs',
              'jira_watchers', 'jira_links', 'jira_issue_components'):
        op.drop_table(t)
    with op.batch_alter_table('jira_issues') as b:
        b.drop_index('ix_jira_issues_fix_version_id')
        b.drop_constraint('fk_jira_issues_fix_version', type_='foreignkey')
        for c in ('environment', 'custom_fields', 'fix_version_id', 'archived', 'flagged',
                  'remaining_estimate_min', 'original_estimate_min', 'start_date'):
            b.drop_column(c)
    with op.batch_alter_table('jira_columns') as b:
        b.drop_column('wip_limit')
    with op.batch_alter_table('jira_projects') as b:
        b.drop_constraint('fk_jira_projects_default_assignee', type_='foreignkey')
        for c in ('archived', 'default_assignee_id', 'enforce_workflow', 'board_type'):
            b.drop_column(c)
    with op.batch_alter_table('user_preferences') as b:
        b.drop_column('jira_email_notifications')
    for t in ('jira_components', 'jira_versions', 'jira_invites'):
        op.drop_table(t)
