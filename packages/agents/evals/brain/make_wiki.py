"""Writes the wiki-shaped fixture of the Brain eval (ADR-0096, ADR-0097): `fixture/wiki-docs/`.

The fixture is a document repository the way a wiki project has one: free spaces under `20-spaces/<space>/` with a home
page (front matter `key`, `order`), pages with `labels`, `owner` and `status`, templates under `_templates/`, headings
that repeat inside a document, links to headings, links to pages that do not exist and a page nothing links to. Everything
the key (`wiki-questions.json`) asks is planted here on purpose; the test of the fixture rebuilds it and compares.

Run it from anywhere: `python make_wiki.py` rewrites the folder; `python make_wiki.py --check` fails when the folder
differs from what this file writes.
"""
import base64
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'fixture', 'wiki-docs')


def page(title, body, **front):
    """A Markdown page: front matter (scalars and short lists), the title, then the body."""
    lines = ['---']
    lines.append(f'title: {title}')
    for key, value in front.items():
        if isinstance(value, tuple):
            # The block form docmd.py writes (docs/reference/document-formats.md).
            lines.append(f'{key}:')
            lines.extend(f'  - "{item}"' for item in value)
        elif isinstance(value, list):
            lines.append(f'{key}: [{", ".join(value)}]')
        else:
            lines.append(f'{key}: {value}')
    lines.extend(['---', '', f'# {title}', '', body.strip(), ''])
    return '\n'.join(lines)


FILES = {}


def add(path, text):
    assert path not in FILES, path
    FILES[path] = text


add('README.md', """# Acme wiki

The project's document repository: the standards and the team spaces of the Acme platform group.

| Space | Folder | What it holds |
| --- | --- | --- |
| Engineering | `20-spaces/eng/` | Onboarding, runbooks and decisions of the platform team |
| People | `20-spaces/hr/` | Leave, remote work and benefits |
| Operations | `20-spaces/ops/` | Services, on-call and incident practice |
""")

add('00-project/README.md', page('Project', """
The charter and the glossary of the Acme platform group.
""", summary='The charter and the glossary of the Acme platform group.'))

add('00-project/glossary.md', page('Glossary', """
## Terms

- **Burn-down**: the planned decline of open work over a sprint.
- **Error budget**: the share of requests a service may fail in a month before feature work stops.
""", labels=['reference'], owner='platform-lead'))

# --- Engineering space -----------------------------------------------------------------------------------------

add('20-spaces/eng/README.md', page('Engineering', """
The platform team's space: how people join, how services are run and what was decided.

## Where to start

New joiners read [Onboarding](onboarding/README.md) first. On-call engineers keep [Runbooks](runbooks/README.md) open.
""", key='ENG', summary='The platform team\'s space: onboarding, runbooks and decisions.',
    order=['onboarding', 'runbooks', 'decisions', '_templates']))

add('20-spaces/eng/onboarding/README.md', page('Onboarding', """
Everything a new engineer does in the first weeks.

## Pages

- [First week](first-week.md)
- [Laptop setup](laptop-setup.md)
- [Access requests](access-requests.md)
""", id='PAGE-ENG-0001', labels=['onboarding', 'how-to'], owner='eng-manager',
    order=['first-week', 'laptop-setup', 'access-requests']))

add('20-spaces/eng/onboarding/first-week.md', page('First week', """
## Overview

You meet your buddy on day one and ship a small change by Friday.

## Checklist

1. Pair with your buddy on the build.
2. Read the [laptop setup](laptop-setup.md) page.
3. Ask for the accounts listed in [access requests](access-requests.md#request-list).

## Overview

The second overview of this page lists the people to meet: the team lead, the on-call lead and the security champion.
""", id='PAGE-ENG-0002', labels=['onboarding', 'how-to'], owner='eng-manager'))

add('20-spaces/eng/onboarding/laptop-setup.md', page('Laptop setup', """
## Install

Install the container runtime, the package manager and the company VPN client.

## Troubleshooting

If the VPN refuses to connect, rotate the certificate with the helper script. The steps are in the
[VPN guide](vpn-guide.md), which a colleague is still writing.

![Laptop sticker sheet](_attachments/stickers.png)
""", id='PAGE-ENG-0003', labels=['onboarding', 'how-to'], owner='it-desk'))

add('20-spaces/eng/onboarding/access-requests.md', page('Access requests', """
## Request list

| System | Who approves | Lead time |
| --- | --- | --- |
| Source hosting | Team lead | 1 day |
| Cloud console | Security champion | 3 days |
| Pager | On-call lead | 1 day |

## Offboarding

Access is removed on the last working day.
""", id='PAGE-ENG-0004', labels=['onboarding', 'security'], owner='security-champion'))

add('20-spaces/eng/runbooks/README.md', page('Runbooks', """
Step-by-step procedures for the platform's services, one page per service or failure.

## Severity

Page the on-call lead for severity 1 and 2. Everything else waits for working hours.
""", id='PAGE-ENG-0010', labels=['runbook'], owner='on-call-lead'))

add('20-spaces/eng/runbooks/payment-outage.md', page('Payment outage', """
## Symptoms

Checkout returns the error `PAY-503` and the payment gateway dashboard shows failed charges.

## Steps

1. Check the gateway status page.
2. Fail over to the secondary gateway with the `gateway-switch` command.
3. Tell the support desk to expect refunds. See the [incident report template](../_templates/incident-report.md).

> [!WARNING]
> Do not fail over while a refund batch is running.

## Rollback

Switch back after the gateway reports twenty clean minutes.
""", id='PAGE-ENG-0011', labels=['runbook', 'sev1', 'payments'], owner='payments-lead'))

add('20-spaces/eng/runbooks/cache-flush.md', page('Cache flush', """
## When

Flush the cache after a bad deploy of the pricing data.

## Steps

1. Run the `cache-purge` command against the edge nodes.
2. Warm the five hottest keys by calling the price endpoint.

The cache holds quokka-grade copies of the catalogue; nobody else uses that name.
""", id='PAGE-ENG-0012', labels=['runbook', 'sev2'], owner='platform-lead'))

add('20-spaces/eng/runbooks/db-failover.md', page('Database failover', """
## Symptoms

Writes fail with `read-only transaction` and the primary is unreachable.

## Steps

1. Confirm the replica lag is under thirty seconds.
2. Promote the replica with the `db-promote` command.
3. Point the services at the new primary.

## Follow-up

File an [incident report](../_templates/incident-report.md) within a day. See also the
[postgres decision](../decisions/0001-use-postgres.md).
""", id='PAGE-ENG-0013', labels=['runbook', 'sev1', 'database'], owner='dba-lead'))

for number, (name, label, owner) in enumerate(
    [
        ('Search service', 'search', 'search-lead'),
        ('Mail relay', 'mail', 'comms-lead'),
        ('Image resizer', 'media', 'media-lead'),
        ('Report builder', 'reporting', 'data-lead'),
        ('Session store', 'identity', 'identity-lead'),
        ('Webhook sender', 'integration', 'integration-lead'),
        ('Batch scheduler', 'batch', 'batch-lead'),
        ('Feature flags', 'config', 'platform-lead'),
    ],
    start=20,
):
    slug = name.lower().replace(' ', '-')
    add(f'20-spaces/eng/runbooks/{slug}.md', page(name, f"""
## Symptoms

The {name.lower()} stops answering and the health check fails.

## Steps

1. Restart the {name.lower()} with the `svc-restart` command.
2. Watch the queue depth for ten minutes.
3. Escalate to the {owner} if it does not recover.
""", id=f'PAGE-ENG-{number:04d}', labels=['runbook', 'sev3', label], owner=owner))

add('20-spaces/eng/decisions/README.md', page('Decisions', """
The decision records of the platform team, newest last.

## How we decide

A decision is proposed in a page of this folder and accepted in the weekly review.
""", id='PAGE-ENG-0030', labels=['decision'], owner='eng-manager',
    order=['0001-use-postgres', '0002-use-queues']))

add('20-spaces/eng/decisions/0001-use-postgres.md', page('Use Postgres for all services', """
## Decision

Every service stores its data in Postgres.

## Status

Replaced by [the queue decision](0002-use-queues.md) for background work only; kept for transactional data.
""", id='PAGE-ENG-0031', labels=['decision', 'database'], owner='dba-lead', status='archived',
    supersededBy='PAGE-ENG-0032'))

add('20-spaces/eng/decisions/0002-use-queues.md', page('Use a queue for background work', """
## Decision

Background work goes through the job queue, never through a cron hidden in a service.

## Consequences

Retries and the dead letter list become visible to everyone.
""", id='PAGE-ENG-0032', labels=['decision', 'queues'], owner='platform-lead'))

add('20-spaces/eng/_templates/incident-report.md', page('Incident report', """
## Summary

What broke, for whom and for how long.

## Timeline

| Time | Event |
| --- | --- |
| | |

## Follow-ups

One owner and one date for each.
""", type='template', labels=['template', 'incident'], owner='on-call-lead'))

add('20-spaces/eng/_templates/decision-record.md', page('Decision record', """
## Decision

State the decision in one sentence.

## Consequences

What becomes easier, and what becomes harder.
""", type='template', labels=['template', 'decision'], owner='eng-manager'))

# --- People space ----------------------------------------------------------------------------------------------

add('20-spaces/hr/README.md', page('People', """
Leave, remote work and benefits of the Acme platform group.
""", key='HR', summary='Leave, remote work and benefits.', order=['leave-policy', 'remote-work', 'benefits']))

add('20-spaces/hr/leave-policy.md', page('Leave policy', """
## Overview

Full-time employees earn twenty-five days of paid leave a year.

## Carry-over

Up to five unused days carry over to March 31 of the next year.

## Sick leave

Report sick leave to your manager before ten in the morning.
""", id='PAGE-HR-0001', labels=['policy', 'leave'], owner='hr-lead'))

add('20-spaces/hr/remote-work.md', page('Remote work', """
## Eligibility

Anyone past probation may work remotely three days a week.

## Equipment

The company ships a monitor and a chair. Leave rules still apply: see the
[carry-over rule](leave-policy.md#carry-over) and the [sick leave rule](leave-policy.md#sick-leave).

## Expenses

Home office costs follow the [expense policy](2019-expenses.md).
""", id='PAGE-HR-0002', labels=['policy', 'remote'], owner='hr-lead'))

add('20-spaces/hr/2019-expenses.md', page('Expense policy 2019', """
## Limits

Meals up to thirty euros a day.
""", id='PAGE-HR-0003', labels=['policy', 'finance'], owner='finance-lead', status='archived'))

add('20-spaces/hr/benefits/README.md', page('Benefits', """
What the company pays for besides salary.
""", id='PAGE-HR-0010', labels=['policy', 'benefits'], owner='hr-lead'))

add('20-spaces/hr/benefits/health.md', page('Health plan', """
## Coverage

The plan covers a yearly check-up, dental care and glasses up to two hundred euros.

## Claims

Send receipts through the benefits portal within ninety days.
""", id='PAGE-HR-0011', labels=['policy', 'benefits', 'health'], owner='hr-lead'))

# --- Operations space ------------------------------------------------------------------------------------------

add('20-spaces/ops/README.md', page('Operations', """
Services, on-call and incident practice.

See the [payment outage runbook](../eng/runbooks/payment-outage.md) for the most common sev1.
""", key='OPS', summary='Services, on-call and incident practice.', order=['on-call', 'services']))

add('20-spaces/ops/on-call.md', page('On-call rota', """
## Rota

The rota changes every Monday at nine. The on-call lead hands over in the channel.

## Escalation

Escalate to the platform lead after thirty minutes without progress. Follow the
[database failover](../eng/runbooks/db-failover.md) page for primary loss.
""", id='PAGE-OPS-0001', labels=['on-call', 'process'], owner='on-call-lead'))

add('20-spaces/ops/services/README.md', page('Services', """
The services the platform group runs, one page each.
""", id='PAGE-OPS-0010', labels=['inventory'], owner='platform-lead'))

add('20-spaces/ops/services/checkout.md', page('Checkout service', """
## Owner

The payments team owns the checkout service.

## Dependencies

Checkout calls the payment gateway and the price endpoint. When the gateway fails, follow the
[payment outage](../../eng/runbooks/payment-outage.md) runbook.

## Children

```kintsugi-children
depth: 1
```
""", id='PAGE-OPS-0011', labels=['inventory', 'payments'], owner='payments-lead'))

add('20-spaces/ops/services/billing.md', page('Billing service', """
## Owner

The finance team owns the billing service. It issues the invoices of the checkout orders.
""", id='PAGE-OPS-0014', labels=('inventory', 'finance'), owner='finance-lead'))

add('20-spaces/ops/cache-purge.md', page('Cache purge', """
This page moved to [Cache flush](../eng/runbooks/cache-flush.md). Update your bookmarks.
""", id='PAGE-OPS-0013', labels=['moved'], owner='platform-lead'))

# A one-pixel PNG: the attachment of a page, a file the Brain does not index.
add('20-spaces/eng/onboarding/_attachments/stickers.png', base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))

add('20-spaces/ops/services/orphan-notes.md', page('Loose notes', """
## Notes

Notes from a workshop. Nothing links here.
""", id='PAGE-OPS-0012', labels=['draft'], owner='platform-lead'))


def write(root):
    if os.path.isdir(root):
        shutil.rmtree(root)
    for path, text in sorted(FILES.items()):
        target = os.path.join(root, *path.split('/'))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        if isinstance(text, bytes):
            with open(target, 'wb') as handle:
                handle.write(text)
        else:
            with open(target, 'w', encoding='utf-8', newline='\n') as handle:
                handle.write(text)


def current(root):
    found = {}
    for folder, _, names in os.walk(root):
        for name in names:
            full = os.path.join(folder, name)
            rel = os.path.relpath(full, root).replace(os.sep, '/')
            if rel.endswith('.md'):
                with open(full, encoding='utf-8', newline='') as handle:
                    found[rel] = handle.read()
            else:
                with open(full, 'rb') as handle:
                    found[rel] = handle.read()
    return found


if __name__ == '__main__':
    if '--check' in sys.argv:
        if current(ROOT) != FILES:
            sys.exit('fixture/wiki-docs differs from make_wiki.py: run `python make_wiki.py`')
        print('fixture/wiki-docs matches make_wiki.py')
    else:
        write(ROOT)
        print(f'wrote {len(FILES)} files to {ROOT}')
