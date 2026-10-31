"""Writes the large part of the Brain eval fixture: two legacy applications of 30 units in all (deterministic).

Each unit has a cryptic program-like name (`rtn04`, `ship03`) and a specification of three rule cards that look
alike across a module. A few units hold the planted answers of `questions.json`, worded differently from the
questions, so an agent finds them by the summaries rather than by the names or by an exact search.

    python packages/agents/evals/brain/make_scale.py [<fixture root>]

The test `test_the_large_part_of_the_fixture_is_what_make_scale_writes` checks that the fixture is its output.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.join(HERE, 'fixture', 'shop-docs')

APPLICATIONS = {
    'catalog': 'The catalog system: the assortment, its prices and stock, the suppliers and the promotions.',
    'fulfilment': 'The fulfilment system: picking, packing, shipping, returns and backorders.',
}

# (application, module, unit prefix, rule code, [(unit title, summary, [(rule title, rule text), ...]), ...])
MODULES = [
    ('catalog', 'assortment', 'ast', 'AST', [
        ('Listing new articles', 'How the batch lists a new article in the catalog.', [
            ('Listing approval', 'A new article is listed only after the category manager approves its sheet.'),
            ('Listing date', 'A listed article becomes visible on the first Monday after its approval.'),
            ('Listing photos', 'An article without at least two photos stays hidden.'),
        ]),
        ('Delisting articles', 'How the batch removes an article from the catalog.', [
            ('Delisting notice', 'An article is delisted 30 days after the supplier gives notice.'),
            ('Remaining stock', 'Remaining stock of a delisted article is sold at a markdown of 20%.'),
            ('Delisting history', 'A delisted article keeps its page, marked as no longer sold, for one year.'),
        ]),
        ('Article variants', 'How sizes and colours of one article are grouped.', [
            ('Variant group', 'Variants of one article share its number and differ by a two-digit suffix.'),
            ('Variant limit', 'An article has at most 40 variants.'),
            ('Variant prices', 'Every variant of an article has the same base price.'),
        ]),
        ('Bundles', 'How articles sold together are listed.', [
            ('Bundle content', 'A bundle holds two to five articles that are also sold alone.'),
            ('Bundle stock', 'A bundle is in stock when every article in it is.'),
            ('Bundle listing', 'A bundle is listed under the category of its most expensive article.'),
        ]),
        ('Seasonal articles', 'How articles sold only part of the year are handled.', [
            ('Season window', 'A seasonal article is listed from the start to the end date of its season.'),
            ('Season preview', 'A seasonal article may be shown 14 days before its season without being sold.'),
            ('Season stock', 'Unsold seasonal stock is moved to the outlet when the season ends.'),
        ]),
        ('Restricted articles', 'How articles with a legal restriction are sold.', [
            ('Age check', 'An article restricted by age is sold only after the customer confirms their age at checkout.'),
            ('Restricted regions', 'An article restricted in a region is hidden to customers of that region.'),
            ('Restricted delivery', 'A restricted article is never left at a pick-up point.'),
        ]),
    ]),
    ('catalog', 'prices', 'cpr', 'CPR', [
        ('Base prices', 'How the base price of an article is set.', [
            ('Price source', 'The base price comes from the supplier price list plus the category margin.'),
            ('Price review', 'Base prices are reviewed every quarter.'),
            ('Price floor', 'A base price is never below the purchase price.'),
        ]),
        ('Price changes', 'How a change of price reaches the shop.', [
            ('Change timing', 'A price change takes effect at midnight on its start date.'),
            ('Change notice', 'A rise of more than 10% is announced to the stores a week ahead.'),
            ('Change history', 'Every price change is kept with who made it.'),
        ]),
        ('Store prices', 'How stores may differ from the national price.', [
            ('Local price', 'A store may sell an article below the national price, never above it.'),
            ('Local limit', 'A local price is at most 15% below the national price.'),
            ('Local expiry', 'A local price ends after 28 days unless renewed.'),
        ]),
        ('Price endings', 'How a computed price is turned into the price shown.', [
            ('Kept endings', 'A computed price that already ends in .99 is shown as it is.'),
            ('Other endings', 'Any other computed price is shown at the nearest multiple of 0.05.'),
            ('Ending ties', 'A computed price exactly halfway between two multiples of 0.05 goes to the higher one.'),
        ]),
        ('Unit prices', 'How the price per kilogram or litre is shown.', [
            ('Unit price shown', 'Articles sold by weight or volume show their price per kilogram or per litre.'),
            ('Unit price digits', 'A unit price is shown with two decimals.'),
            ('Unit price source', 'The unit price is computed from the net content on the label.'),
        ]),
        ('Price matching', 'How the shop answers a lower price elsewhere.', [
            ('Match request', 'A customer may ask for a lower price seen at a listed competitor within 7 days.'),
            ('Match proof', 'A match needs a screenshot or a receipt from the competitor.'),
            ('Match exclusions', 'Marketplace sellers are never matched.'),
        ]),
    ]),
    ('fulfilment', 'shipping', 'ship', 'SHP', [
        ('Delivery promise', 'How the delivery date shown at checkout is computed.', [
            ('Promise cut-off', 'An order placed before 14:00 leaves the warehouse the same day.'),
            ('Promise weekend', 'No parcel leaves the warehouse on Sunday.'),
            ('Promise buffer', 'The promised date adds one day to the carrier\'s own estimate.'),
        ]),
        ('Standard parcels', 'How ordinary parcels are sent.', [
            ('Standard carrier', 'A parcel of up to 30 kg goes with the parcel carrier Parcelway.'),
            ('Standard tracking', 'Every standard parcel gets a tracking number sent by e-mail.'),
            ('Standard attempts', 'Parcelway tries to deliver twice, then leaves the parcel at a pick-up point.'),
        ]),
        ('Freight', 'How bulky consignments are sent.', [
            ('Freight carrier', 'A consignment above that weight travels with the haulier Northline, booked a day ahead.'),
            ('Freight slot', 'The customer chooses a four-hour delivery slot for a freight consignment.'),
            ('Freight unloading', 'The haulier unloads at the kerb only.'),
        ]),
        ('Express delivery', 'How next-day parcels are sent.', [
            ('Express carrier', 'Express parcels go with the courier Swiftpost.'),
            ('Express cut-off', 'Express is offered for orders placed before 12:00.'),
            ('Express regions', 'Express is not offered on the islands.'),
        ]),
        ('Pick-up points', 'How parcels are left at pick-up points.', [
            ('Pick-up choice', 'A customer may choose any pick-up point within 20 km of their address.'),
            ('Pick-up holding', 'A parcel waits 10 days at the pick-up point, then goes back.'),
            ('Pick-up size', 'A parcel larger than 60 cm on any side is never sent to a pick-up point.'),
        ]),
        ('Split shipments', 'How an order shipped in several parcels is handled.', [
            ('Split rule', 'An order is split when some of its articles are not in stock.'),
            ('Split cost', 'The customer pays delivery once, whatever the number of parcels.'),
            ('Split notice', 'The customer is told of each parcel as it leaves.'),
        ]),
    ]),
    ('fulfilment', 'returns', 'rtn', 'RTN', [
        ('Unopened articles', 'How an unopened article is taken back.', [
            ('Unopened window', 'An unopened article may be sent back within 30 days of delivery.'),
            ('Unopened refund', 'The full price is refunded once the article is checked.'),
            ('Unopened shipping', 'Return shipping of an unopened article is free.'),
        ]),
        ('Opened articles', 'How an opened article is taken back.', [
            ('Opened window', 'An opened article may be sent back within 14 days of delivery.'),
            ('Opened refund', 'The price minus a restocking charge of 10% is refunded.'),
            ('Opened check', 'An opened article is checked for missing parts before the refund.'),
        ]),
        ('Return labels', 'How a customer gets a return label.', [
            ('Label request', 'A return label is requested from the order page.'),
            ('Label carrier', 'Return labels are always for Parcelway.'),
            ('Label validity', 'A return label is valid for 14 days.'),
        ]),
        ('Articles that arrive broken', 'How an article that arrives broken is handled.', [
            ('Broken window', 'An article that arrives broken is reported within 7 days of delivery.'),
            ('Broken remedy', 'The customer gets a new one sent at once; there is no refund unless none is left.'),
            ('Broken proof', 'A photo of the article and of its box is attached to the report.'),
        ]),
        ('Personalised articles', 'How personalised articles are treated.', [
            ('Personalised window', 'A personalised article is never taken back unless it is faulty.'),
            ('Personalised fault', 'A faulty personalised article is made again.'),
            ('Personalised notice', 'The checkout says so before a personalised article is paid.'),
        ]),
        ('Refund payment', 'How a refund reaches the customer.', [
            ('Refund method', 'A refund goes back to the means of payment used for the order.'),
            ('Refund timing', 'A refund is paid within 5 working days of the check.'),
            ('Refund vouchers', 'A customer may take a voucher worth 5% more instead of a refund.'),
        ]),
    ]),
    ('fulfilment', 'backorders', 'bko', 'BKO', [
        ('Backorder creation', 'How an order line becomes a backorder.', [
            ('Backorder trigger', 'An order line without stock becomes a backorder when the supplier confirms a date.'),
            ('Backorder date', 'The customer sees the supplier date plus two days.'),
            ('Backorder limit', 'A customer may hold at most 10 backorder lines.'),
        ]),
        ('Backorder expiry', 'What happens to a backorder that waits too long.', [
            ('Expiry period', 'A backorder line still undelivered 60 days after the order is dropped by the batch.'),
            ('Expiry notice', 'The customer is told by e-mail when a line is dropped.'),
            ('Expiry payment', 'A dropped line that was paid is refunded the same day.'),
        ]),
        ('Customer cancellation', 'How a customer cancels a backorder.', [
            ('Cancel any time', 'A customer may cancel a backorder line at any time before it ships.'),
            ('Cancel refund', 'A cancelled paid line is refunded within 5 working days.'),
            ('Cancel record', 'The reason given by the customer is kept for the buyers.'),
        ]),
        ('Backorder checks', 'How the batch follows backorders.', [
            ('Nightly check', 'Every backorder line is checked against incoming stock every night.'),
            ('Supplier chase', 'A supplier is chased when its date has passed by three days.'),
            ('Check report', 'The buyers receive a weekly list of late backorder lines.'),
        ]),
        ('Partial deliveries', 'How a backorder delivered in parts is handled.', [
            ('Partial ship', 'A backorder line is shipped as soon as one unit arrives.'),
            ('Partial rest', 'The rest of the line stays a backorder.'),
            ('Partial cost', 'The customer pays delivery once for the whole line.'),
        ]),
        ('Substitutes', 'How a substitute is offered for a backorder.', [
            ('Substitute offer', 'The buyers may offer a substitute of the same or a higher price.'),
            ('Substitute price', 'The customer pays the price of the article ordered.'),
            ('Substitute answer', 'Without an answer within 7 days the backorder goes on.'),
        ]),
    ]),
]


def files():
    """{repository path: text} of the large part of the fixture."""
    out = {}
    for app, text in APPLICATIONS.items():
        out[f'10-applications/{app}/README.md'] = f'# {app.capitalize()}\n\n{text}\n'
    for app, module, prefix, code, units in MODULES:
        for number, (title, summary, rules) in enumerate(units, 1):
            unit = f'{prefix}{number:02d}'
            lines = ['---', 'status: "understood"', f'rules: {len(rules)}', '---', f'# {title}', '', summary, '', '## Business rules', '']
            for index, (rule_title, rule_text) in enumerate(rules, 1):
                lines += [f'### RULE-{code}{number:02d}-{index:04d}: {rule_title}', '', rule_text, '']
            out[f'10-applications/{app}/01-legacy/{module}/{unit}/spec.md'] = '\n'.join(lines)
    return out


def write(root):
    for path, text in files().items():
        target = os.path.join(root, *path.split('/'))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(text)
    return len(files())


if __name__ == '__main__':
    print(write(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ROOT), 'files written')
