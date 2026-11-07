"use client";

import { useEffect, useState } from "react";

type ReviewListing = {
  id: number;
  ownerEmail: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  role: string;
  propertyType: string;
  beds: number;
  baths: number;
  monthlyRent: number;
  verificationMethod: string;
  imageKey: string | null;
  status: string;
  createdAt: string;
};

export default function AdminClient({
  userEmail,
  signOutPath,
}: {
  userEmail: string;
  signOutPath: string;
}) {
  const [items, setItems] = useState<ReviewListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("pending");

  async function load() {
    const response = await fetch("/api/admin/listings");
    const data = (await response.json()) as {
      listings?: ReviewListing[];
      error?: string;
    };
    if (response.ok) setItems(data.listings ?? []);
    else setMessage(data.error ?? "Couldn’t load the review queue.");
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function review(id: number, status: string) {
    const response = await fetch(`/api/admin/listings/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = (await response.json()) as {
      listing?: ReviewListing;
      error?: string;
    };
    if (!response.ok || !data.listing) {
      setMessage(data.error ?? "Review update failed.");
      return;
    }
    setItems((current) =>
      current.map((item) => (item.id === id ? data.listing! : item)),
    );
    setMessage(
      status === "approved"
        ? "Property approved for publishing."
        : "Property rejected and kept off the marketplace.",
    );
  }

  const visible =
    filter === "all" ? items : items.filter((item) => item.status === filter);

  return (
    <main className="admin-shell">
      <header className="dashboard-nav">
        <a className="brand" href="/"><span className="brand-mark">D</span>Door Sure <b className="brand-state">OHIO</b></a>
        <div><span>{userEmail}</span><a href="/dashboard">Landlord view</a><a href={signOutPath}>Sign out</a></div>
      </header>
      <section className="admin-heading">
        <div><p className="eyebrow">Trust operations</p><h1>Property review queue</h1><p>Nothing reaches renters until identity, authority, and property evidence pass review.</p></div>
        <div className="review-count"><strong>{items.filter((item) => item.status === "pending").length}</strong><span>waiting for review</span></div>
      </section>
      <section className="admin-content">
        <div className="review-filters">
          {["pending", "approved", "rejected", "all"].map((value) => (
            <button className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{value}</button>
          ))}
        </div>
        {message && <p className="admin-message">{message}</p>}
        {loading ? <div className="admin-empty">Loading review queue…</div> : visible.length ? (
          <div className="review-grid">
            {visible.map((item) => (
              <article className="review-card" key={item.id}>
                <div className="review-photo">
                  {item.imageKey ? <img src={`/api/listings/${item.id}/photo`} alt="" /> : <span>No property photo</span>}
                  <b className={`status ${item.status}`}>{item.status}</b>
                </div>
                <div className="review-body">
                  <small>Submitted by {item.ownerEmail}</small>
                  <h2>{item.address}</h2>
                  <p>{item.city}, {item.state} {item.zip}</p>
                  <dl>
                    <div><dt>Property</dt><dd>{item.propertyType} · {item.beds} bd · {item.baths} ba</dd></div>
                    <div><dt>Rent</dt><dd>${item.monthlyRent.toLocaleString()}/month</dd></div>
                    <div><dt>Authority</dt><dd>{item.role}</dd></div>
                    <div><dt>Evidence path</dt><dd>{item.verificationMethod}</dd></div>
                  </dl>
                  <div className="review-actions">
                    <button className="reject" onClick={() => void review(item.id, "rejected")}>Reject</button>
                    <button className="approve" onClick={() => void review(item.id, "approved")}>✓ Approve listing</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : <div className="admin-empty"><span>✓</span><h2>Queue is clear</h2><p>No {filter === "all" ? "" : filter} properties right now.</p></div>}
      </section>
    </main>
  );
}
