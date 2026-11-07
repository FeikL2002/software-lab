"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";

type Property = {
  city: string;
  state: string;
  price: string;
  type: string;
  beds: number;
  baths: number;
  note: string;
  accent: string;
  icon: string;
  label: string;
};

const properties: Property[] = [
  {
    city: "Cleveland",
    state: "OH",
    price: "$74,900",
    type: "Single family",
    beds: 3,
    baths: 1,
    note: "Vacant • Light rehab",
    accent: "amber",
    icon: "🏠",
    label: "NEW TODAY",
  },
  {
    city: "Memphis",
    state: "TN",
    price: "$119,000",
    type: "Duplex",
    beds: 4,
    baths: 2,
    note: "Tenant occupied • Value-add",
    accent: "blue",
    icon: "🏘️",
    label: "DIRECT TO SELLER",
  },
  {
    city: "Jacksonville",
    state: "FL",
    price: "$162,500",
    type: "Single family",
    beds: 3,
    baths: 2,
    note: "Inherited • Needs updates",
    accent: "coral",
    icon: "🌴",
    label: "MOTIVATED SELLER",
  },
  {
    city: "Detroit",
    state: "MI",
    price: "$52,000",
    type: "Single family",
    beds: 2,
    baths: 1,
    note: "Fire damage • Cash only",
    accent: "mint",
    icon: "🔥",
    label: "FIRE DAMAGED",
  },
  {
    city: "Birmingham",
    state: "AL",
    price: "$89,500",
    type: "Single family",
    beds: 3,
    baths: 2,
    note: "Pre-foreclosure • Quick close",
    accent: "violet",
    icon: "🔑",
    label: "QUICK CLOSE",
  },
  {
    city: "Indianapolis",
    state: "IN",
    price: "$135,000",
    type: "Townhouse",
    beds: 3,
    baths: 2,
    note: "Cosmetic rehab • Vacant",
    accent: "rose",
    icon: "🏡",
    label: "JUST LISTED",
  },
];

export default function Home() {
  const [filter, setFilter] = useState("All properties");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [photos, setPhotos] = useState<{ file: File; name: string; url: string }[]>([]);
  const [photoError, setPhotoError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    return properties.filter((property) => {
      const matchesType =
        filter === "All properties" ||
        (filter === "Under $100K" &&
          Number(property.price.replace(/\D/g, "")) < 100000) ||
        (filter === "Fire damaged" && property.note.includes("Fire damage")) ||
        property.type === filter;
      const matchesQuery =
        !q ||
        `${property.city} ${property.state} ${property.type} ${property.note}`
          .toLowerCase()
          .includes(q);
      return matchesType && matchesQuery;
    });
  }, [filter, query]);

  async function submitListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError("");
    setIsSubmitting(true);
    const form = new FormData(event.currentTarget);
    form.delete("photos");
    photos.forEach((photo) => form.append("photos", photo.file));

    try {
      const response = await fetch("/api/listings", { method: "POST", body: form });
      const result = (await response.json()) as { checkoutUrl?: string; error?: string };
      if (!response.ok || !result.checkoutUrl) {
        throw new Error(result.error ?? "Your listing could not be submitted.");
      }
      window.location.href = result.checkoutUrl;
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Your listing could not be submitted.");
      setSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    const available = 5 - photos.length;

    if (selected.length > available) {
      setPhotoError(`You can add ${available} more photo${available === 1 ? "" : "s"}.`);
    } else {
      setPhotoError("");
    }

    selected.slice(0, available).forEach((file) => {
      if (!file.type.startsWith("image/")) {
        setPhotoError("Please choose image files only.");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setPhotoError("Each photo must be 10 MB or smaller.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setPhotos((current) =>
          current.length < 5
            ? [...current, { file, name: file.name, url: String(reader.result) }]
            : current
        );
      };
      reader.readAsDataURL(file);
    });

    event.target.value = "";
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="OffMarket home">
          <span className="brand-mark">OM</span>
          <span>OFFMARKET</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#feed">Browse deals</a>
          <a href="#how">How it works</a>
        </nav>
        <button className="button button-dark" onClick={() => setShowForm(true)}>
          List a property <span>→</span>
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> FOR MOTIVATED SELLERS &amp; SERIOUS BUYERS</p>
          <h1>Property problems.<br /><em>Buyer solutions.</em></h1>
          <p className="hero-sub">
            Put your distressed, burned, or fire-damaged property in front of
            cash buyers for one simple price. No commissions. No runaround.
          </p>
          <div className="hero-actions">
            <button className="button button-coral" onClick={() => setShowForm(true)}>
              List my property for $10 <span>↗</span>
            </button>
            <a className="text-link" href="#feed">Browse active deals ↓</a>
          </div>
          <div className="trust-row">
            <span><b>1,240+</b> active buyers</span>
            <span><b>48 hrs</b> average first inquiry</span>
            <span><b>$10</b> one-time listing</span>
          </div>
        </div>
        <div className="hero-card">
          <div className="hero-card-top">
            <span className="live-dot" /> LIVE OPPORTUNITY
            <span className="card-count">01 / 06</span>
          </div>
          <div className="property-art">
            <div className="sun" />
            <div className="house">
              <div className="roof" />
              <div className="house-body"><i /><i /><b /></div>
            </div>
            <span className="as-is">AS-IS</span>
          </div>
          <div className="hero-card-details">
            <div>
              <p>SELLER ASKING</p>
              <strong>$74,900</strong>
            </div>
            <div className="detail-divider" />
            <div>
              <p>LOCATION</p>
              <strong>Cleveland, OH</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="feed-section" id="feed">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><span /> FRESH OPPORTUNITIES</p>
            <h2>Deals worth a look.</h2>
          </div>
          <div className="search-wrap">
            <span>⌕</span>
            <input
              aria-label="Search properties"
              placeholder="City, state, or keyword"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="filter-row" aria-label="Property filters">
          {["All properties", "Fire damaged", "Single family", "Duplex", "Townhouse", "Under $100K"].map((item) => (
            <button
              key={item}
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
          <span>{visible.length} active listings</span>
        </div>

        <div className="property-grid">
          {visible.map((property) => {
            const key = property.city;
            const isSaved = saved.includes(key);
            return (
              <article className="property-card" key={key}>
                <div className={`card-visual ${property.accent}`}>
                  <span className="listing-label">{property.label}</span>
                  <span className="property-icon">{property.icon}</span>
                  <button
                    className={`save ${isSaved ? "saved" : ""}`}
                    aria-label={`${isSaved ? "Remove" : "Save"} ${property.city} property`}
                    onClick={() =>
                      setSaved((current) =>
                        isSaved ? current.filter((item) => item !== key) : [...current, key]
                      )
                    }
                  >
                    {isSaved ? "♥" : "♡"}
                  </button>
                </div>
                <div className="card-body">
                  <div className="card-title">
                    <h3>{property.city}, {property.state}</h3>
                    <strong>{property.price}</strong>
                  </div>
                  <p className="specs">{property.beds} bd <span>•</span> {property.baths} ba <span>•</span> {property.type}</p>
                  <p className="note">{property.note}</p>
                  <button onClick={() => alert("Buyer inquiry opened — connect your phone or email service to receive these leads.")}>
                    View opportunity <span>↗</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {visible.length === 0 && (
          <div className="empty-state">No exact matches yet. Try another city or property type.</div>
        )}
      </section>

      <section className="how-section" id="how">
        <div>
          <p className="eyebrow light"><span /> NO AGENT REQUIRED</p>
          <h2>From problem property<br />to buyer-ready.</h2>
        </div>
        <ol>
          <li><b>01</b><div><strong>Tell us about the property</strong><p>Add the basics, your contact information, and up to five property photos.</p></div></li>
          <li><b>02</b><div><strong>Pay $10 once</strong><p>Your listing stays visible for 30 days. No subscription and no commission.</p></div></li>
          <li><b>03</b><div><strong>Hear from interested buyers</strong><p>Qualified buyers contact you directly so you can choose the right offer.</p></div></li>
        </ol>
        <button className="button button-cream" onClick={() => setShowForm(true)}>
          Start my listing <span>→</span>
        </button>
      </section>

      <footer>
        <a className="brand" href="#top"><span className="brand-mark">OM</span><span>OFFMARKET</span></a>
        <p>Connecting motivated property owners with ready buyers.</p>
        <span>© 2026 OffMarket</span>
      </footer>

      {showForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowForm(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="listing-title" onMouseDown={(e) => e.stopPropagation()}>
            <button className="modal-close" aria-label="Close listing form" onClick={() => setShowForm(false)}>×</button>
            {!submitted ? (
              <>
                <p className="eyebrow"><span /> ONE-TIME $10 LISTING</p>
                <h2 id="listing-title">Get your property seen.</h2>
                <p className="modal-intro">Share a few details—including fire or burn damage. Your contact information is only used to connect you with interested buyers.</p>
                <form onSubmit={submitListing}>
                  <div className="form-row">
                    <label>Full name<input name="name" required placeholder="Jordan Smith" autoComplete="name" /></label>
                    <label>Phone number<input name="phone" required type="tel" placeholder="(555) 123-4567" autoComplete="tel" /></label>
                  </div>
                  <label>Property address<input name="address" required placeholder="123 Main St, Cleveland, OH" autoComplete="street-address" /></label>
                  <div className="form-row">
                    <label>Asking price<input name="price" required inputMode="numeric" placeholder="$95,000" /></label>
                    <label>Property condition
                      <select name="condition" required defaultValue="">
                        <option value="" disabled>Select condition</option>
                        <option>Needs light repairs</option>
                        <option>Needs major repairs</option>
                        <option>Fire or water damage</option>
                        <option>Vacant / inherited</option>
                      </select>
                    </label>
                  </div>
                  <label>What should buyers know?<textarea name="details" placeholder="Tell buyers about repairs, timeline, occupancy, or anything else..." rows={3} /></label>
                  <div className="photo-field">
                    <div className="photo-heading">
                      <div>
                        <strong>Property photos</strong>
                        <span>Add up to 5 clear photos • JPG, PNG or HEIC • 10 MB each</span>
                      </div>
                      <b>{photos.length}/5</b>
                    </div>
                    {photos.length < 5 && (
                      <label className="upload-box">
                        <input
                          type="file"
                          name="photos"
                          accept="image/*"
                          multiple
                          onChange={addPhotos}
                        />
                        <span className="upload-icon">＋</span>
                        <strong>Choose property photos</strong>
                        <small>Tap to select one or several images</small>
                      </label>
                    )}
                    {photos.length > 0 && (
                      <div className="photo-previews">
                        {photos.map((photo, index) => (
                          <div className="photo-preview" key={`${photo.name}-${index}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={photo.url} alt={`Property upload ${index + 1}`} />
                            <button
                              type="button"
                              aria-label={`Remove photo ${index + 1}`}
                              onClick={() => {
                                setPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index));
                                setPhotoError("");
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {photoError && <p className="photo-error" role="alert">{photoError}</p>}
                  </div>
                  <div className="checkout-line"><span>One 30-day property listing</span><strong>$10.00</strong></div>
                  <button className="button button-coral pay-button" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Saving your listing…" : "Continue to secure payment"} <span>→</span>
                  </button>
                  <p className="secure-note">🔒 Secure checkout • No subscription • No commission</p>
                </form>
              </>
            ) : (
              <div className="success">
                <span className="success-icon">✓</span>
                <p className="eyebrow centered">LISTING SAVED</p>
                <h2>Payment activation needed.</h2>
                <p>{submitError || "The listing is saved, but checkout is not available yet."}</p>
                <button className="reset-link" onClick={() => setSubmitted(false)}>Edit listing details</button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
