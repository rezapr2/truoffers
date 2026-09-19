# Website import robot: data protection

This covers **TruOffersBot**, the robot that imports takeaway offers from takeaways' own websites.
It describes what the robot collects, why, how long each thing is kept, and how people get data
removed. It reflects what the code does today. Have it reviewed by whoever is responsible for data
protection before the robot is used on real websites.

## What the robot does

An administrator submits a takeaway's website. The robot fetches a small number of public pages
from that site and extracts two things:

- the business's listing details;
- the promotions it advertises.

Nothing is published automatically. Every imported offer waits in a review queue until an
administrator approves it or the business confirms it.

The robot only visits websites an administrator has authorised. It never visits:

- marketplaces (Just Eat, Uber Eats, Deliveroo and similar);
- search engines or maps;
- social networks;
- any page behind a login.

It obeys robots.txt, `X-Robots-Tag` and `<meta name="robots">`, and identifies itself with a fixed
User-Agent that links to `/bot`.

**The one exception to robots.txt.** A business owner may tell us they want their offers listed even
though their website's robots.txt asks every bot to stay away, for example because the ordering
platform that hosts the site set it that way. A super administrator can then record that consent
(who agreed, how, and when) against that one website. The record is written to the audit log, only a
super administrator can create or remove it, and it applies to that website alone. It changes nothing
else: opt-outs and removal requests (which delete it), the never-crawl list, pauses, blocked paths,
page-level `noindex`/`nofollow`, the rate limit and the fixed User-Agent all still apply. `/bot`
tells site owners about the exception.

The same exception can be recorded on an ordering platform's policy, for the platform's own websites.
It requires that the platform has agreed in writing that we may read its clients' websites: the policy
must be allowed on a written agreement, with the agreement's reference, and the exception is removed
automatically if that changes. It covers only websites linked to that platform, and an opt-out by a
business still ends it for that business's website.

**Websites on a shared template.** Administrators can teach the robot one website template, for
example a web studio's theme, and reuse that across every authorised website built on it. To do
this the robot records the template's structural traits: generator tag, footer attribution,
stylesheet and script paths, CSS class names, page skeleton and URL patterns.

An administrator can also register an **authorised network**: the client sitemap of a studio or
ordering provider, together with the basis for using it (a written agreement reference, or notes
from a terms review). Websites listed in that sitemap become authorised. Websites the robot only
finds as links still wait for an administrator, and opted-out websites are never re-authorised.

**Keeping listings accurate.** Published imported offers are checked again on a schedule: daily,
every 6 hours near their end date, and weekly for websites with nothing published. Offers the
robot can no longer find are hidden straight away. Changed terms wait for an administrator. Offers a
business manages are never changed by a recheck; the business is only told that its website
changed.

**JavaScript-only websites.** Where an administrator has enabled it, a website whose offers only
appear after JavaScript runs is opened in a headless browser, using the same identity and
permission checks. Images, media, fonts and analytics or advertising services are never loaded.
Only the page text needed for evidence is kept, exactly as for ordinary pages.

**Claim invitations.** Administrators can generate an invitation for a takeaway to claim its
listing. TruOffers never sends it. The administrator sends it themselves and records that they
did.

## Lawful basis

**Legitimate interests** (UK GDPR Art. 6(1)(f)). Summary of the assessment:

| Question | Answer |
| --- | --- |
| Purpose | Help customers find current offers from local takeaways, and help takeaways be found without paying marketplace commission. |
| Necessity | Offers change often. Reading the business's own public website is the least intrusive way to keep listings accurate, compared with third-party aggregators or asking customers. |
| Balance | The data is what the business itself publishes to attract customers. It is mostly business data, and people reasonably expect it to be seen. The safeguards below limit the impact, and removal takes effect immediately. |

## Personal data involved

Most of the data is about businesses, not people. It becomes personal data where the business is a
sole trader or partnership, or where contact details identify a person.

| Data | Source | Where it is stored |
| --- | --- | --- |
| Business name, phone number, address and postcode | Contact and footer blocks, structured data (JSON-LD) | `ScrapedWebsite.businesses[].extracted`; `Business` once an admin creates or links a listing |
| Offer terms (title, discount, dates, promo code, conditions) | Offer and menu pages | `ExtractedOfferCandidate`; `Offer` once approved |
| Short page excerpts supporting each extracted value | The same pages | `sources[].excerpt` and `evidence` on candidates and imported offers |
| Adapter builder output: offer excerpts (up to 300 characters) and, in test results, the branch name, phone, address and postcode each example website showed | Example websites an administrator picked | `WebsiteFingerprint.examples`; `ScraperAdapter.testResults` |
| Template traits (class names, asset paths, generator and attribution text, page skeleton, URL patterns) | Each website's pages | `ScrapedWebsite.siteMarkers`; `WebsiteFingerprint.markers`. Not personal data: business names, phone numbers and addresses are never used as traits |
| Authorised network: name, sitemap URLs, basis and agreement reference | Entered by an administrator | `AuthorisedNetwork` |
| Changes a recheck found on a published offer: the terms before and after, with supporting excerpts | The same pages | `OfferRevision`, kept as the offer's revision history |
| Recheck state: when an offer was last seen and how many checks missed it | Rechecks | `Offer.lastSeenAt`, `absentChecks` |
| Claim invitation: the business, a hash of the link, who generated it, when it expires or was used | Entered by an administrator | `MerchantClaimInvitation` |
| Notes an administrator keeps about contacting a business (channel, date, free text that may name a person) | Entered by an administrator | `MerchantClaimInvitation.contacts` |
| Removal requester's name (optional) and email address | The public removal form | `DomainOptOut.requestedBy` |
| Administrator actions (who, what, when, IP address) | The admin tools | `AdminAuditLog` |

The robot does not collect:

- reviews or customer names;
- images;
- anything behind a login;
- anything from pages marked `noindex`.

## Minimisation

- **No page bodies are stored.** Pages are processed in memory by the worker. Only structured
  values and short excerpts are saved.
- **Excerpts are capped at 500 characters** and cover only the sentence that supports a value.
- **Each run fetches every page once, and at most 50 pages per website** by default.
- **Evidence and excerpts stay internal.** They are never included in public API responses. Public
  pages show only the source domain and the date it was last checked.
- **Adapter tests create nothing.** Testing an adapter on its example websites stores a summary for
  the administrator; it never creates candidates or offers.
- **Rendering loads as little as possible.** Rendering happens only when the ordinary page has no
  offers (or, for an ordering platform whose menu only loads in the browser, on one page), and covers
  at most 3 pages. Images, media and fonts are never loaded, and analytics and advertising services
  are never contacted, so the robot never appears in the business's analytics. Data the page's own
  scripts load from the website while it renders, such as its menu, is read in memory and never
  stored; only the offers extracted from it, with short excerpts, are kept.
- **Claim links are never stored.** Only a hash is kept. The messages an administrator copies are
  generated on the spot and not saved.
- **Template matching reuses what it has.** Matching a website against templates reuses traits read
  in the last 24 hours instead of fetching the site again.

## Retention

| Data | Kept for |
| --- | --- |
| Excerpts on rejected or failed candidates | 90 days after the decision, then redacted |
| Excerpts on imported offers that expired or were removed | 90 days after expiry or removal, then redacted |
| Excerpts for a domain that opted out or was the subject of a removal request | Redacted immediately |
| Adapter builder output (template analysis examples, adapter test results) | 90 days after the analysis or test ran, then redacted. Branch contact details in test results are deleted at the same time. A new analysis or test replaces it |
| Adapter builder output for a website that opted out or was the subject of a removal request | Redacted immediately, for that website only |
| Excerpts on revisions that were applied, discarded or closed | 90 days after the decision, then redacted |
| Revisions and their excerpts for a domain that opted out or was the subject of a removal request | Pending ones closed and excerpts redacted immediately |
| Claim invitations and contact notes | Deleted a year after the link expired, was used or was replaced |
| Job run records | 180 days (TTL index) |
| Intermediate run data (stage hand-over between queue jobs) | Deleted when the run ends; a nightly job clears runs that never finished |
| Opt-out records and requester emails | While the opt-out is in force, so the domain stays excluded |
| Audit log | Kept as the record of administrative decisions |

Redaction keeps the record (URL, page title, check date) but deletes the excerpt text. For adapter
builder output it keeps the counts, offer titles, parsed values and field methods, and deletes the
excerpts, the text behind each field and branch contact details. The retention job runs nightly at
03:00 (`RetentionService`).

## Outreach and PECR

Claim invitations are for administrators to send themselves. The admin page reminds them that
marketing by email, text or WhatsApp to sole traders is covered by PECR. They must check there is a
lawful basis and include an opt-out before sending. No code path in TruOffers sends email, SMS or
WhatsApp messages; an automated test checks that no messaging client is present. Every invitation,
replaced invitation and recorded contact is in the audit log.

## AI processing

AI extraction is **off by default**. It runs only when both of these are true:

- an administrator has enabled it in scraper settings;
- `ANTHROPIC_API_KEY` is configured.

When it runs:

- It is used only if the standard extractors found no offers on a website.
- It is limited to 3 pages per run.
- Only offer-relevant text blocks from those pages are sent to Anthropic, never whole pages.

Every date, price and promo code the model returns must appear word for word in the page text, or
it is discarded. AI output only ever creates review candidates, like any other extraction.

## Removal requests and data subject rights

**Public removal form (`/removal-request`, `POST /api/removal-requests`).** Anyone who says they
represent the business can submit a request. It takes effect immediately, without waiting for an
administrator:

1. The source domain and all its subdomains are opted out, and in-progress crawls of them are
   cancelled.
2. Every imported offer from that domain that the robot manages is unpublished (status
   `removed`), and its excerpts are redacted.
3. Open candidates from the domain are closed, and their excerpts are redacted.
4. If the website was an example for a template or an adapter test, its excerpts and branch
   contact details are removed from that analysis and those test results.
5. Changes waiting for review on its offers are closed, and their excerpts are redacted. The website
   is no longer rechecked.
6. Listings created from that website that no business has claimed are hidden (`suspended`) until
   an administrator reviews them.
7. Administrators see the request in the unacknowledged opt-out queue.

An opted-out website stays excluded from template matching and network discovery: a network
sitemap that lists it doesn't authorise it again.

The form always gives the same response, so it does not reveal whether a listing exists. It is
rate-limited to 5 requests an hour per IP address.

**What a removal request doesn't change:**

- Offers the business has confirmed or edited itself are **merchant-managed** and stay published.
  They belong to the business, which can remove them from its dashboard.
- Lifting an opt-out does not republish anything. The website has to be authorised again before
  the robot will visit it.

**Other rights requests** (access, rectification, erasure beyond the above) are handled by
administrators. Useful places to look:

- the audit log (`/admin/scraper/audit`);
- the website's record in `/admin/scraper/websites`.

## Security

- The worker is the only process that fetches external pages. It refuses:
  - private, loopback and cloud-metadata addresses;
  - ports other than 80 and 443;
  - more than 5 redirects;
  - responses over 2 MB, or compressed more than 20:1.
- DNS answers are validated and then pinned for each request, which prevents DNS rebinding.
- The headless browser connects only through a local proxy that applies the same checks to every
  request it makes, including each step of a redirect. It runs in its own container with no extra
  privileges and a memory limit, and it stops when a website shows a challenge or login page.
- Publishing, verifying and handing offers to merchants can only happen in an administrator's or
  merchant's request. The database layer rejects these changes from the worker or scheduled jobs.
- Every administrative decision is recorded in an append-only audit log.
