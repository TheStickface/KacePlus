const v = (val) => val ?? '(unknown)';

function footer(channel) {
  return {
    type: 'TextBlock',
    text: channel,
    size: 'Small',
    color: 'Default',
    isSubtle: true,
  };
}

function card(body, channel) {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [...body, footer(channel)],
        },
      },
    ],
  };
}

module.exports = {
  'ticket.created': (data, channel) =>
    card(
      [
        { type: 'TextBlock', text: `🎫 New Ticket #${v(data.id)}: ${v(data.title)}`, weight: 'Bolder', size: 'Medium', wrap: true },
        { type: 'FactSet', facts: [
          { title: 'Submitter', value: v(data.submitter) },
          { title: 'Category', value: v(data.category) },
          { title: 'Priority', value: v(data.priority) },
          { title: 'Status', value: v(data.status) },
        ]},
      ],
      channel
    ),

  'ticket.assigned': (data, channel) =>
    card(
      [
        { type: 'TextBlock', text: `👤 Ticket #${v(data.id)} Assigned: ${v(data.title)}`, weight: 'Bolder', size: 'Medium', wrap: true },
        { type: 'FactSet', facts: [
          { title: 'Assigned To', value: v(data.assigned_to) },
          { title: 'Assigned By', value: v(data.assigned_by) },
        ]},
      ],
      channel
    ),

  'ticket.status_changed': (data, channel) =>
    card(
      [
        { type: 'TextBlock', text: `🔄 Status Changed — Ticket #${v(data.id)}: ${v(data.title)}`, weight: 'Bolder', size: 'Medium', wrap: true },
        { type: 'FactSet', facts: [
          { title: 'From', value: v(data.old_status) },
          { title: 'To', value: v(data.new_status) },
          { title: 'Changed By', value: v(data.changed_by) },
        ]},
      ],
      channel
    ),

  'ticket.sla_breach': (data, channel) =>
    card(
      [
        { type: 'TextBlock', text: `⚠️ SLA Breach — Ticket #${v(data.id)}: ${v(data.title)}`, weight: 'Bolder', size: 'Medium', color: 'Attention', wrap: true },
        { type: 'FactSet', facts: [
          { title: 'SLA Type', value: v(data.sla_type) },
          { title: 'Breached At', value: v(data.breached_at) },
        ]},
      ],
      channel
    ),
};
