const templates = require('../../../src/integrations/teams/templates');

const CHANNEL = 'IT Helpdesk';

describe('templates.ticket.created', () => {
  it('renders title and submitter', () => {
    const card = templates['ticket.created'](
      { id: 1, title: 'Broken keyboard', submitter: 'jane.doe', priority: 'High', category: 'Hardware', status: 'New' },
      CHANNEL
    );
    const body = JSON.stringify(card);
    expect(body).toContain('Broken keyboard');
    expect(body).toContain('jane.doe');
    expect(body).toContain('High');
  });

  it('renders graceful fallback for missing fields', () => {
    const card = templates['ticket.created']({}, CHANNEL);
    expect(JSON.stringify(card)).toContain('(unknown)');
  });

  it('includes channel name in footer', () => {
    const card = templates['ticket.created']({ id: 1 }, CHANNEL);
    expect(JSON.stringify(card)).toContain('IT Helpdesk');
  });
});

describe('templates.ticket.assigned', () => {
  it('renders assignee', () => {
    const card = templates['ticket.assigned'](
      { id: 2, title: 'Monitor flicker', assigned_to: 'john.smith', assigned_by: 'jane.doe' },
      CHANNEL
    );
    expect(JSON.stringify(card)).toContain('john.smith');
    expect(JSON.stringify(card)).toContain('jane.doe');
  });

  it('renders graceful fallback for missing fields', () => {
    const card = templates['ticket.assigned']({}, CHANNEL);
    expect(JSON.stringify(card)).toContain('(unknown)');
  });

  it('includes channel name in footer', () => {
    const card = templates['ticket.assigned']({ id: 2 }, CHANNEL);
    expect(JSON.stringify(card)).toContain('IT Helpdesk');
  });
});

describe('templates.ticket.status_changed', () => {
  it('renders old and new status', () => {
    const card = templates['ticket.status_changed'](
      { id: 3, title: 'Slow PC', old_status: 'New', new_status: 'In Progress', changed_by: 'john.smith' },
      CHANNEL
    );
    const body = JSON.stringify(card);
    expect(body).toContain('New');
    expect(body).toContain('In Progress');
  });

  it('renders graceful fallback for missing fields', () => {
    const card = templates['ticket.status_changed']({}, CHANNEL);
    expect(JSON.stringify(card)).toContain('(unknown)');
  });

  it('includes channel name in footer', () => {
    const card = templates['ticket.status_changed']({ id: 3 }, CHANNEL);
    expect(JSON.stringify(card)).toContain('IT Helpdesk');
  });
});

describe('templates.ticket.sla_breach', () => {
  it('renders sla_type and breached_at', () => {
    const card = templates['ticket.sla_breach'](
      { id: 4, title: 'No internet', sla_type: 'resolution', breached_at: '2026-03-22T16:00:00Z' },
      CHANNEL
    );
    const body = JSON.stringify(card);
    expect(body).toContain('resolution');
    expect(body).toContain('2026-03-22T16:00:00Z');
  });

  it('renders graceful fallback for missing fields', () => {
    const card = templates['ticket.sla_breach']({}, CHANNEL);
    expect(JSON.stringify(card)).toContain('(unknown)');
  });

  it('includes channel name in footer', () => {
    const card = templates['ticket.sla_breach']({ id: 4 }, CHANNEL);
    expect(JSON.stringify(card)).toContain('IT Helpdesk');
  });
});
