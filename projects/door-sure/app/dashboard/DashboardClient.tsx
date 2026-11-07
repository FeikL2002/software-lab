"use client";

import { FormEvent, useEffect, useState } from "react";

type StoredListing = {
  id: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  propertyType: string;
  beds: number;
  baths: number;
  monthlyRent: number;
  verificationMethod: string;
  imageKey: string | null;
  status: string;
  createdAt: string;
};

type Inquiry = {
  id: number;
  listingId: number;
  renterEmail: string;
  message: string;
  status: string;
  createdAt: string;
  address: string;
  city: string;
};

const blankForm = {
  address: "",
  city: "",
  zip: "",
  role: "",
  propertyType: "",
  beds: "1",
  baths: "1",
  monthlyRent: "",
  verificationMethod: "",
};

export default function DashboardClient({
  user,
  signOutPath,
}: {
  user: { name: string; email: string };
  signOutPath: string;
}) {
  const [items, setItems] = useState<StoredListing[]>([]);
  const [form, setForm] = useState(blankForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [step, setStep] = useState(1);
  const [photo, setPhoto] = useState<File | null>(null);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);

  async function loadListings() {
    setLoading(true);
    const response = await fetch("/api/listings");
    const data = (await response.json()) as {
      listings?: StoredListing[];
      error?: string;
    };
    if (response.ok) setItems(data.listings ?? []);
    else setMessage(data.error ?? "We couldn’t load your properties.");
    setLoading(false);
  }

  async function loadInquiries() {
    const response = await fetch("/api/inquiries");
    const data = (await response.json()) as {
      inquiries?: Inquiry[];
    };
    if (response.ok) setInquiries(data.inquiries ?? []);
  }

  useEffect(() => {
    void loadListings();
    void loadInquiries();
  }, []);

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/listings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = (await response.json()) as {
      listing?: StoredListing;
      error?: string;
    };
    if (!response.ok || !data.listing) {
      setSaving(false);
      setMessage(data.error ?? "We couldn’t save this property.");
      return;
    }
    let successMessage =
      "Property submitted. Door Sure — OHIO review is now pending.";
    if (photo) {
      const upload = new FormData();
      upload.set("photo", photo);
      const photoResponse = await fetch(`/api/listings/${data.listing.id}/photo`, {
        method: "POST",
        body: upload,
      });
      if (!photoResponse.ok) {
        const photoData = (await photoResponse.json()) as { error?: string };
        successMessage = `Property saved, but the photo failed: ${photoData.error ?? "try again later"}`;
      }
    }
    setSaving(false);
    setItems((current) => [data.listing!, ...current]);
    setForm(blankForm);
    setPhoto(null);
    setStep(1);
    setMessage(successMessage);
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-nav">
        <a className="brand" href="/">
          <span className="brand-mark">D</span>Door Sure <b className="brand-state">OHIO</b>
        </a>
        <div>
          <span>{user.email}</span>
          <a href="/admin">Review queue</a>
          <a href={signOutPath}>Sign out</a>
        </div>
      </header>

      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">Ohio landlord beta</p>
          <h1>Welcome, {user.name.split(" ")[0]}.</h1>
          <p>
            Add an Ohio property and choose how you’ll prove your authority to
            rent it. Every submission stays private until Door Sure — OHIO approves it.
          </p>
        </div>
        <div className="account-seal">
          <span>✓</span>
          <p><strong>Identity connected</strong>Your signed-in account is attached to every submission.</p>
        </div>
      </section>

      <section className="dashboard-grid">
        <form className="property-form" onSubmit={submit}>
          <div className="form-heading">
            <div>
              <p className="eyebrow">New property</p>
              <h2>Submit for verification</h2>
            </div>
            <span>Step {step} of 3</span>
          </div>
          <div className="step-track"><i className={`step-${step}`} /></div>

          {step === 1 && (
            <div className="form-step">
              <h3>Where is the property?</h3>
              <label>Street address<input required value={form.address} onChange={(e) => update("address", e.target.value)} placeholder="123 Main Street" /></label>
              <div className="form-row">
                <label>City<input required value={form.city} onChange={(e) => update("city", e.target.value)} placeholder="Columbus" /></label>
                <label>State<input value="OH" readOnly /></label>
                <label>ZIP code<input required inputMode="numeric" pattern="[0-9]{5}" value={form.zip} onChange={(e) => update("zip", e.target.value)} placeholder="43215" /></label>
              </div>
              <button className="button dark full" type="button" onClick={() => {
                if (form.address && form.city && /^\d{5}$/.test(form.zip)) setStep(2);
                else setMessage("Add a complete Ohio address first.");
              }}>Property details →</button>
            </div>
          )}

          {step === 2 && (
            <div className="form-step">
              <h3>Tell renters what it is.</h3>
              <label>Your role<select required value={form.role} onChange={(e) => update("role", e.target.value)}><option value="">Select one</option><option>Property owner</option><option>Property manager</option><option>Licensed agent or broker</option></select></label>
              <label>Property type<select required value={form.propertyType} onChange={(e) => update("propertyType", e.target.value)}><option value="">Select one</option><option>Apartment</option><option>House</option><option>Townhome</option><option>Duplex</option><option>Condo</option></select></label>
              <div className="form-row three">
                <label>Bedrooms<input required type="number" min="0" max="20" value={form.beds} onChange={(e) => update("beds", e.target.value)} /></label>
                <label>Bathrooms<input required type="number" min="1" max="20" step=".5" value={form.baths} onChange={(e) => update("baths", e.target.value)} /></label>
                <label>Monthly rent<input required type="number" min="1" value={form.monthlyRent} onChange={(e) => update("monthlyRent", e.target.value)} placeholder="1500" /></label>
              </div>
              <label className="photo-field">
                Main property photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
                />
                <span>{photo ? photo.name : "JPG, PNG, or WebP · up to 8 MB"}</span>
              </label>
              <div className="form-actions"><button type="button" onClick={() => setStep(1)}>← Back</button><button className="button dark" type="button" onClick={() => {
                if (form.role && form.propertyType && form.monthlyRent) setStep(3);
                else setMessage("Complete the property details first.");
              }}>Verification →</button></div>
            </div>
          )}

          {step === 3 && (
            <div className="form-step">
              <h3>How should we verify authority?</h3>
              <p className="step-copy">We’ll compare your information with Ohio county records. If the names differ, choose a supporting method.</p>
              <div className="verification-options">
                {[
                  ["County owner record", "My name appears as the property owner."],
                  ["Management agreement", "I manage the home for its legal owner."],
                  ["Broker or agent authority", "I’m authorized to market this rental."],
                  ["Live video review", "I’ll show access to the property on video."],
                ].map(([title, copy]) => (
                  <label className={form.verificationMethod === title ? "selected" : ""} key={title}>
                    <input type="radio" name="method" value={title} checked={form.verificationMethod === title} onChange={(e) => update("verificationMethod", e.target.value)} />
                    <span><strong>{title}</strong>{copy}</span>
                  </label>
                ))}
              </div>
              <label className="consent"><input required type="checkbox" /><span>I certify that I’m authorized to list this property and that the information is accurate.</span></label>
              <div className="form-actions"><button type="button" onClick={() => setStep(2)}>← Back</button><button className="button coral" disabled={saving || !form.verificationMethod} type="submit">{saving ? "Submitting…" : "Submit for review →"}</button></div>
            </div>
          )}
          {message && <p className="form-message" role="status">{message}</p>}
        </form>

        <aside className="property-list">
          <div className="form-heading">
            <div><p className="eyebrow">Your portfolio</p><h2>Ohio properties</h2></div>
            <span>{items.length}</span>
          </div>
          {loading ? (
            <div className="portfolio-empty">Loading your properties…</div>
          ) : items.length ? (
            <div className="portfolio-items">
              {items.map((item) => (
                <article key={item.id}>
                  {item.imageKey && <img className="portfolio-photo" src={`/api/listings/${item.id}/photo`} alt="" />}
                  <div><span className={`status ${item.status}`}>{item.status}</span><small>{item.city}, {item.state} {item.zip}</small></div>
                  <h3>{item.address}</h3>
                  <p>{item.propertyType} · {item.beds} bd · {item.baths} ba · ${item.monthlyRent.toLocaleString()}/mo</p>
                  <footer><span>Verification</span><strong>{item.verificationMethod}</strong></footer>
                </article>
              ))}
            </div>
          ) : (
            <div className="portfolio-empty"><span>⌂</span><h3>No properties yet</h3><p>Your first saved submission will appear here.</p></div>
          )}
        </aside>
      </section>

      <section className="inbox-section">
        <div className="inbox-heading">
          <div><p className="eyebrow">Secure inquiries</p><h2>Renter inbox</h2></div>
          <span>{inquiries.length} {inquiries.length === 1 ? "message" : "messages"}</span>
        </div>
        {inquiries.length ? (
          <div className="inquiry-list">
            {inquiries.map((inquiry) => (
              <article key={inquiry.id}>
                <div className="inquiry-avatar">{inquiry.renterEmail.slice(0, 1).toUpperCase()}</div>
                <div>
                  <header><strong>{inquiry.renterEmail}</strong><span>{new Date(inquiry.createdAt).toLocaleDateString()}</span></header>
                  <small>{inquiry.address} · {inquiry.city}</small>
                  <p>{inquiry.message}</p>
                  <a href={`mailto:${inquiry.renterEmail}?subject=${encodeURIComponent(`Door Sure — OHIO inquiry: ${inquiry.address}`)}`}>Reply to renter →</a>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="inbox-empty">Approved properties will receive secure renter inquiries here.</div>
        )}
      </section>
    </main>
  );
}
