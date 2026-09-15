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

**Websites on a shared template.** Administrators can teach the robot one website template, for
example a web studio's theme, and reuse that across every authorised website built on it. To do
this the robot records the template's structural traits: generator tag, footer attribution,
stylesheet and script paths, CSS class names, page skeleton and URL patterns.

An administrator can also register an **authorised network**: the client sitemap of a studio or
ordering provider, together with the basis for using it (a written agreement reference, or notes
from a terms review). Websites listed in that sitemap become authorised. Websites the robot only
finds as links still wait for an administrator, and opted-out websites are never re-authorised.

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
| Job run records | 180 days (TTL index) |
| Intermediate run data (stage hand-over between queue jobs) | Deleted when the run ends; a nightly job clears runs that never finished |
| Opt-out records and requester emails | While the opt-out is in force, so the domain stays excluded |
| Audit log | Kept as the record of administrative decisions |

Redaction keeps the record (URL, page title, check date) but deletes the excerpt text. For adapter
builder output it keeps the counts, offer titles, parsed values and field methods, and deletes the
excerpts, the text behind each field and branch contact details. The retention job runs nightly at
03:00 (`RetentionService`).

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
5. Listings created from that website that no business has claimed are hidden (`suspended`) until
   an administrator reviews them.
6. Administrators see the request in the unacknowledged opt-out queue.

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
- Publishing, verifying and handing offers to merchants can only happen in an administrator's or
  merchant's request. The database layer rejects these changes from the worker or scheduled jobs.
- Every administrative decision is recorded in an append-only audit log.
