"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Listing = {
  id: number | string;
  dbId?: number;
  title: string;
  neighborhood: string;
  city: string;
  price: number;
  beds: number;
  baths: number;
  type: string;
  image: string;
  tags: string[];
  verified: string[];
  fresh: string;
  live?: boolean;
};

const listings: Listing[] = [
  {
    id: 1,
    title: "Sunlit brick duplex near Schiller Park",
    neighborhood: "German Village",
    city: "Columbus, OH",
    price: 1895,
    beds: 2,
    baths: 1,
    type: "Apartment",
    image:
      "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1200&q=85",
    tags: ["Pet friendly", "In-unit laundry"],
    verified: ["Owner identity", "Property records", "Fresh photos"],
    fresh: "Verified 2 days ago",
  },
  {
    id: 2,
    title: "Quiet apartment near Edgewater Park",
    neighborhood: "Detroit–Shoreway",
    city: "Cleveland, OH",
    price: 1425,
    beds: 1,
    baths: 1,
    type: "Apartment",
    image:
      "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=85",
    tags: ["Parking", "Outdoor space"],
    verified: ["Manager identity", "Management authority", "Live video"],
    fresh: "Verified yesterday",
  },
  {
    id: 3,
    title: "Renovated home with a fenced backyard",
    neighborhood: "Oakley",
    city: "Cincinnati, OH",
    price: 2175,
    beds: 3,
    baths: 2,
    type: "House",
    image:
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85",
    tags: ["Dogs welcome", "Garage"],
    verified: ["Owner identity", "Property records", "Live video"],
    fresh: "Verified 4 days ago",
  },
  {
    id: 4,
    title: "Modern loft steps from RiverScape",
    neighborhood: "Webster Station",
    city: "Dayton, OH",
    price: 1350,
    beds: 1,
    baths: 1,
    type: "Loft",
    image:
      "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1200&q=85",
    tags: ["Doorman", "Roof deck"],
    verified: ["Manager identity", "Management authority", "Fresh photos"],
    fresh: "Verified today",
  },
  {
    id: 5,
    title: "Warm two-bedroom on a tree-lined street",
    neighborhood: "Highland Square",
    city: "Akron, OH",
    price: 1275,
    beds: 2,
    baths: 1,
    type: "Apartment",
    image:
      "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1200&q=85",
    tags: ["Heat included", "Cats welcome"],
    verified: ["Owner identity", "Property records", "Fresh photos"],
    fresh: "Verified 3 days ago",
  },
  {
    id: 6,
    title: "Bright townhome near the riverfront",
    neighborhood: "Warehouse District",
    city: "Toledo, OH",
    price: 1650,
    beds: 2,
    baths: 2,
    type: "Townhome",
    image:
      "https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=1200&q=85",
    tags: ["EV charging", "Balcony"],
    verified: ["Owner identity", "Property records", "Live video"],
    fresh: "Verified today",
  },
];

export default function Home() {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [maxPrice, setMaxPrice] = useState("Any price");
  const [beds, setBeds] = useState("Any beds");
  const [saved, setSaved] = useState<Array<number | string>>([]);
  const [liveListings, setLiveListings] = useState<Listing[]>([]);
  const [trustOpen, setTrustOpen] = useState(false);
  const [listingOpen, setListingOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [contactListing, setContactListing] = useState<Listing | null>(null);
  const [inquiryMessage, setInquiryMessage] = useState("");
  const [sendingInquiry, setSendingInquiry] = useState(false);

  useEffect(() => {
    void fetch("/api/public/listings")
      .then((response) => response.json())
      .then(
        (data: {
          listings?: Array<{
            id: number;
            address: string;
            city: string;
            state: string;
            zip: string;
            propertyType: string;
            beds: number;
            baths: number;
            monthlyRent: number;
            imageUrl: string | null;
          }>;
        }) => {
          setLiveListings(
            (data.listings ?? []).map((item) => ({
              id: `live-${item.id}`,
              dbId: item.id,
              title: item.address,
              neighborhood: item.zip,
              city: `${item.city}, ${item.state}`,
              price: item.monthlyRent,
              beds: item.beds,
              baths: item.baths,
              type: item.propertyType,
              image:
                item.imageUrl ??
                "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1200&q=85",
              tags: ["Approved listing", "Message on Door Sure — OHIO"],
              verified: ["Signed-in landlord", "Authority reviewed", "Property approved"],
              fresh: "Live on Door Sure — OHIO",
              live: true,
            })),
          );
        },
      )
      .catch(() => setLiveListings([]));
  }, []);

  const allListings = useMemo(
    () => [...liveListings, ...listings],
    [liveListings],
  );

  const results = useMemo(() => {
    const max = maxPrice === "Any price" ? Infinity : Number(maxPrice);
    const bedCount = beds === "Any beds" ? 0 : Number(beds);
    const term = activeQuery.trim().toLowerCase();
    return allListings.filter(
      (listing) =>
        (!term ||
          `${listing.city} ${listing.neighborhood} ${listing.title}`
            .toLowerCase()
            .includes(term)) &&
        listing.price <= max &&
        listing.beds >= bedCount,
    );
  }, [activeQuery, maxPrice, beds, allListings]);

  function search(event: FormEvent) {
    event.preventDefault();
    setActiveQuery(query);
    document
      .getElementById("homes")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleSaved(id: number | string) {
    setSaved((current) =>
      current.includes(id)
        ? current.filter((listingId) => listingId !== id)
        : [...current, id],
    );
  }

  function submitListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.location.href = "/dashboard";
  }

  async function sendInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactListing?.dbId) return;
    setSendingInquiry(true);
    const response = await fetch("/api/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        listingId: contactListing.dbId,
        message: inquiryMessage,
      }),
    });
    const data = (await response.json()) as { error?: string };
    setSendingInquiry(false);
    if (response.status === 401) {
      window.location.href = "/signin-with-chatgpt?return_to=%2F";
      return;
    }
    if (!response.ok) {
      setNotice(data.error ?? "Your message could not be sent.");
      return;
    }
    setContactListing(null);
    setInquiryMessage("");
    setNotice("Message sent securely through Door Sure — OHIO.");
  }

  return (
    <main>
      <div className="announcement">
        <span>Launching across Ohio</span>
        Free verified listings for founding Ohio landlords.
      </div>

      <nav className="nav" aria-label="Main navigation">
        <a className="brand" href="#">
          <span className="brand-mark" aria-hidden="true">
            D
          </span>
          Door Sure <b className="brand-state">OHIO</b>
        </a>
        <div className="nav-links">
          <a href="#homes">Find a home</a>
          <button className="link-button" onClick={() => setTrustOpen(true)}>
            How we verify
          </button>
          <button className="button ghost" onClick={() => setListingOpen(true)}>
            List a property
          </button>
          <button
            className="saved-pill"
            aria-label={`${saved.length} saved homes`}
            onClick={() => {
              setNotice(
                saved.length
                  ? `You have ${saved.length} saved ${saved.length === 1 ? "home" : "homes"}.`
                  : "Save a home and it will show up here.",
              );
            }}
          >
            ♡ <span>{saved.length}</span>
          </button>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A safer way home in Ohio</p>
          <h1>Rent the home.<br />Skip the doubt.</h1>
          <p className="hero-sub">
            From Columbus to Cleveland to Cincinnati, every Door Sure — OHIO listing
            shows who was verified, what was checked, and when.
          </p>
          <form className="search" onSubmit={search}>
            <label className="search-location">
              <span>Where do you want to live?</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Try Columbus, Cleveland, or Cincinnati"
              />
            </label>
            <label>
              <span>Price</span>
              <select
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value)}
              >
                <option>Any price</option>
                <option value="2000">Up to $2,000</option>
                <option value="2500">Up to $2,500</option>
                <option value="3000">Up to $3,000</option>
                <option value="3500">Up to $3,500</option>
              </select>
            </label>
            <label>
              <span>Beds</span>
              <select value={beds} onChange={(event) => setBeds(event.target.value)}>
                <option>Any beds</option>
                <option value="1">1+ bed</option>
                <option value="2">2+ beds</option>
                <option value="3">3+ beds</option>
              </select>
            </label>
            <button className="search-button" type="submit">
              Search homes <span aria-hidden="true">→</span>
            </button>
          </form>
          <div className="trust-line">
            <div className="avatars" aria-hidden="true">
              <span>MK</span><span>JA</span><span>RL</span>
            </div>
            <p>
              <strong>Built for peace of mind</strong>
              Renters never pay to browse or message.
            </p>
          </div>
        </div>

        <div className="hero-visual" aria-label="A verified Door Sure — OHIO rental">
          <img
            src="https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1500&q=90"
            alt="Bright, welcoming apartment interior"
          />
          <div className="verification-card">
            <div className="check-seal">✓</div>
            <div>
              <p>Door Sure — OHIO verified</p>
              <span>Identity + property records matched</span>
            </div>
          </div>
          <div className="safe-card">
            <span className="shield">◆</span>
            <div><strong>Payment protected</strong><small>No wire transfers. Ever.</small></div>
          </div>
        </div>
      </section>

      <section className="proof">
        <p>Three checks before an Ohio listing goes live</p>
        <div className="proof-item"><b>01</b><span><strong>Person</strong>Government ID + selfie match</span></div>
        <div className="proof-item"><b>02</b><span><strong>Property</strong>County records or authority confirmed</span></div>
        <div className="proof-item"><b>03</b><span><strong>Place</strong>Fresh photos or guided video</span></div>
      </section>

      <section className="listings-section" id="homes">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Ohio · Freshly checked</p>
            <h2>Verified homes across the Buckeye State.</h2>
          </div>
          <p>
            Every check has a date. If something changes, the badge comes off
            until we verify it again.
          </p>
        </div>

        <div className="results-bar">
          <span>
            <strong>{results.length} verified homes</strong>
            {activeQuery ? ` matching “${activeQuery}”` : " ready to explore"}
          </span>
          <button onClick={() => setTrustOpen(true)}>What “verified” means ↗</button>
        </div>

        {results.length ? (
          <div className="listing-grid">
            {results.map((listing) => (
              <article className="listing-card" key={listing.id}>
                <div className="listing-image">
                  <img src={listing.image} alt="" />
                  <span className="verified-badge">✓ Door Sure — OHIO verified</span>
                  <button
                    className={`heart ${saved.includes(listing.id) ? "active" : ""}`}
                    onClick={() => toggleSaved(listing.id)}
                    aria-label={
                      saved.includes(listing.id)
                        ? `Remove ${listing.title} from saved homes`
                        : `Save ${listing.title}`
                    }
                  >
                    {saved.includes(listing.id) ? "♥" : "♡"}
                  </button>
                </div>
                <div className="listing-body">
                  <div className="price-row">
                    <h3>${listing.price.toLocaleString()}<small>/mo</small></h3>
                    <span>{listing.fresh}</span>
                  </div>
                  <h4>{listing.title}</h4>
                  <p>{listing.neighborhood} · {listing.city}</p>
                  <div className="facts">
                    <span>{listing.beds} bd</span>
                    <span>{listing.baths} ba</span>
                    <span>{listing.type}</span>
                  </div>
                  <div className="tag-row">
                    {listing.tags.map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                  <details>
                    <summary>See verification details</summary>
                    <ul>
                      {listing.verified.map((item) => <li key={item}>✓ {item}</li>)}
                    </ul>
                  </details>
                  {listing.live ? (
                    <button
                      className="contact-landlord"
                      onClick={() => setContactListing(listing)}
                    >
                      Message verified landlord →
                    </button>
                  ) : (
                    <span className="demo-label">Preview listing</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span>⌂</span>
            <h3>No exact matches yet</h3>
            <p>Try a higher price or fewer bedrooms. We only show homes that passed verification.</p>
            <button
              className="button dark"
              onClick={() => {
                setActiveQuery("");
                setQuery("");
                setMaxPrice("Any price");
                setBeds("Any beds");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </section>

      <section className="promise">
        <div className="promise-copy">
          <p className="eyebrow light">The Door Sure — OHIO promise</p>
          <h2>A badge that actually tells you something.</h2>
          <p>
            Other sites ask you to spot the scam. We build the checks into the
            listing, conversation, and payment journey.
          </p>
          <button className="button cream" onClick={() => setTrustOpen(true)}>
            See our verification standard
          </button>
        </div>
        <div className="promise-list">
          <div><span>✓</span><p><strong>Know who you’re talking to</strong>Identity checks for every person who publishes a home.</p></div>
          <div><span>✓</span><p><strong>Know they can rent it</strong>Ohio county property records or management documents matched to the address.</p></div>
          <div><span>✓</span><p><strong>Keep the conversation safe</strong>Scam warnings when someone pushes payment or messaging elsewhere.</p></div>
          <div><span>✓</span><p><strong>See what changed</strong>Edits to price, contact, or payment details trigger another review.</p></div>
        </div>
      </section>

      <section className="landlord-cta">
        <p className="eyebrow">For Ohio landlords</p>
        <h2>Help set a safer standard for renting in Ohio.</h2>
        <p>Founding landlords in Columbus, Cleveland, Cincinnati, Dayton, Akron, and Toledo can verify and list free during early access.</p>
        <button className="button coral" onClick={() => setListingOpen(true)}>Verify my property →</button>
      </section>

      <footer>
        <a className="brand footer-brand" href="#"><span className="brand-mark">D</span>Door Sure <b className="brand-state">OHIO</b></a>
        <p>Ohio homes. Real people. Clear proof.</p>
        <div><a href="#homes">Find a home</a><button onClick={() => setTrustOpen(true)}>Safety</button><a href="mailto:hello@doorsure.com">Contact</a></div>
        <small>© 2026 Door Sure — OHIO. Early access experience.</small>
      </footer>

      {notice && (
        <div className="toast" role="status">
          <span>✓</span>{notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button>
        </div>
      )}

      {trustOpen && (
        <div className="modal-backdrop" onMouseDown={() => setTrustOpen(false)}>
          <section className="modal trust-modal" role="dialog" aria-modal="true" aria-labelledby="trust-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setTrustOpen(false)} aria-label="Close">×</button>
            <p className="eyebrow">Our verification standard</p>
            <h2 id="trust-title">Proof, not promises.</h2>
            <p className="modal-intro">A Door Sure — OHIO badge opens into a clear record of what we checked and when we checked it.</p>
            <div className="trust-steps">
              <div><b>1</b><span><strong>Identity match</strong>Government ID, live selfie, phone, and email.</span></div>
              <div><b>2</b><span><strong>Authority match</strong>Ohio county property records or signed management authorization.</span></div>
              <div><b>3</b><span><strong>Property presence</strong>Fresh guided photos or a live video walkthrough.</span></div>
              <div><b>4</b><span><strong>Ongoing monitoring</strong>Risky edits, reports, and stale listings trigger review.</span></div>
            </div>
            <div className="warning-box"><strong>Door Sure — OHIO will never ask you to wire money.</strong><span>Keep messages and future payments in Door Sure — OHIO so our safety checks can help protect you.</span></div>
          </section>
        </div>
      )}

      {listingOpen && (
        <div className="modal-backdrop" onMouseDown={() => setListingOpen(false)}>
          <section className="modal listing-modal" role="dialog" aria-modal="true" aria-labelledby="listing-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setListingOpen(false)} aria-label="Close">×</button>
            <p className="eyebrow">Founding landlord access</p>
            <h2 id="listing-title">Start with your property.</h2>
            <p className="modal-intro">Tell us where it is. We’ll guide you through identity and ownership verification next.</p>
            <form onSubmit={submitListing}>
              <label>Property address<input required placeholder="123 Main Street" /></label>
              <div className="form-row">
                <label>City<input required placeholder="City" /></label>
                <label>State<input required defaultValue="OH" maxLength={2} /></label>
              </div>
              <label>Your role<select required defaultValue=""><option value="" disabled>Select one</option><option>Property owner</option><option>Property manager</option><option>Licensed agent or broker</option></select></label>
              <label>Email<input required type="email" placeholder="you@example.com" /></label>
              <label className="checkbox"><input required type="checkbox" /><span>I understand that Door Sure — OHIO will verify my identity and authority to list this property.</span></label>
              <button className="button dark full" type="submit">Sign in and verify property →</button>
            </form>
            <small>Free during early access. We never sell verification documents.</small>
          </section>
        </div>
      )}

      {contactListing && (
        <div className="modal-backdrop" onMouseDown={() => setContactListing(null)}>
          <section className="modal inquiry-modal" role="dialog" aria-modal="true" aria-labelledby="inquiry-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setContactListing(null)} aria-label="Close">×</button>
            <p className="eyebrow">Secure Door Sure — OHIO message</p>
            <h2 id="inquiry-title">Ask about this home.</h2>
            <div className="inquiry-property">
              <strong>{contactListing.title}</strong>
              <span>{contactListing.city} · ${contactListing.price.toLocaleString()}/mo</span>
            </div>
            <form onSubmit={sendInquiry}>
              <label>
                Your message
                <textarea
                  required
                  minLength={10}
                  maxLength={1200}
                  value={inquiryMessage}
                  onChange={(event) => setInquiryMessage(event.target.value)}
                  placeholder="Hi, I’m interested in this home. Is it available for a tour this week?"
                />
              </label>
              <div className="message-safety">◆ Keep personal and payment details out of your first message. Door Sure — OHIO never recommends wire transfers.</div>
              <button className="button dark full" disabled={sendingInquiry} type="submit">{sendingInquiry ? "Sending…" : "Send secure message →"}</button>
            </form>
            <small>You’ll sign in before sending so the landlord knows they’re speaking with a real person.</small>
          </section>
        </div>
      )}
    </main>
  );
}
