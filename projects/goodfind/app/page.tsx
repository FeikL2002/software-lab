"use client";

import { useEffect, useMemo, useState } from "react";

type Screen = "feed" | "list" | "profile";
type UserListing = {
  id: number;
  title: string;
  location: string;
  startDate: string;
  description: string;
  status: string;
  views: number;
  saves: number;
  photoUrl?: string | null;
};

const sales = [
  {
    id: 1,
    seller: "Maya R.",
    avatar: "MR",
    distance: "0.7 mi",
    area: "Maplewood",
    title: "Mid-century finds & home decor",
    time: "Today · 8 AM–2 PM",
    image:
      "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=1400&q=85",
    tags: ["Furniture", "Decor", "Vintage"],
    likes: 48,
    address: "184 Laurel Ave",
    description: "A carefully curated mix of walnut furniture, warm lighting, framed art, ceramics, and small home accents. Most pieces are in excellent condition.",
    items: ["Walnut lounge chair · $75", "Ceramic table lamps · $20", "Framed prints · from $8"],
  },
  {
    id: 2,
    seller: "The Parkers",
    avatar: "TP",
    distance: "1.2 mi",
    area: "Oak Street",
    title: "Big family clean-out",
    time: "Today · 9 AM–4 PM",
    image:
      "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1400&q=85",
    tags: ["Kids", "Tools", "Kitchen"],
    likes: 31,
    address: "62 Oak Street",
    description: "Something for every room: children’s gear, hand tools, kitchenware, games, and a few larger furniture pieces. Early birds welcome.",
    items: ["Cordless drill set · $35", "Kids bikes · from $25", "Cookware bundle · $18"],
  },
  {
    id: 3,
    seller: "Nina S.",
    avatar: "NS",
    distance: "2.4 mi",
    area: "Riverside",
    title: "Records, books & retro treasures",
    time: "Tomorrow · 10 AM–3 PM",
    image:
      "https://images.unsplash.com/photo-1461360228754-6e81c478b882?auto=format&fit=crop&w=1400&q=85",
    tags: ["Vinyl", "Books", "Collectibles"],
    likes: 72,
    address: "9 Riverbend Lane",
    description: "A collector’s weekend sale with classic records, art and design books, film cameras, and small retro pieces from the 60s through the 90s.",
    items: ["Vinyl records · from $4", "35mm film camera · $60", "Art books · from $6"],
  },
];

export default function Home() {
  const [screen, setScreen] = useState<Screen>("feed");
  const [radius, setRadius] = useState("5 miles");
  const [saved, setSaved] = useState<number[]>([3]);
  const [liked, setLiked] = useState<number[]>([]);
  const [notice, setNotice] = useState("");
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All nearby");
  const [selectedSale, setSelectedSale] = useState<(typeof sales)[number] | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [paid, setPaid] = useState(false);
  const [cardName, setCardName] = useState("");
  const [description, setDescription] = useState("");
  const [userListing, setUserListing] = useState<UserListing | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [problemOpen, setProblemOpen] = useState(false);
  const [problem, setProblem] = useState("");
  const [sendingProblem, setSendingProblem] = useState(false);

  useEffect(() => {
    fetch("/api/listings")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data?.listings?.[0]) setUserListing(data.listings[0] as UserListing);
      })
      .catch(() => undefined);
  }, []);

  const nav = (next: Screen) => {
    setScreen(next);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggle = (
    id: number,
    values: number[],
    setter: (values: number[]) => void,
  ) => {
    setter(values.includes(id) ? values.filter((item) => item !== id) : [...values, id]);
  };

  const progress = useMemo(() => `${Math.min(100, Math.round((step / 3) * 100))}%`, [step]);
  const filteredSales = useMemo(() => {
    const term = query.trim().toLowerCase();
    return sales.filter((sale) => {
      const categoryMatch = category === "All nearby" || category === "Open now"
        ? true
        : sale.tags.includes(category);
      const textMatch = !term || [sale.title, sale.area, ...sale.tags].join(" ").toLowerCase().includes(term);
      return categoryMatch && textMatch;
    });
  }, [category, query]);

  const publishListing = async () => {
    setPublishing(true);
    try {
      const response = await fetch("/api/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, location, startDate: date, description }),
      });
      if (!response.ok) throw new Error("Unable to publish");
      const data = await response.json();
      let listing = data.listing as UserListing;
      if (photo) {
        const form = new FormData();
        form.append("photo", photo);
        form.append("listingId", String(listing.id));
        const uploadResponse = await fetch("/api/upload", { method: "POST", body: form });
        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json();
          listing = { ...listing, photoUrl: uploadData.photoUrl };
        } else {
          setNotice("Your listing is live, but the photo could not be uploaded.");
        }
      }
      setUserListing(listing);
      setPaid(true);
    } catch {
      setNotice("We couldn’t publish just yet. Please try again.");
    } finally {
      setPublishing(false);
    }
  };

  const choosePhoto = (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setNotice("Choose one JPG, PNG, or WebP photo under 5 MB.");
      return;
    }
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const submitProblem = async () => {
    if (!problem.trim()) return;
    setSendingProblem(true);
    try {
      const response = await fetch("/api/problems", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: problem, page: screen }),
      });
      if (!response.ok) throw new Error("Unable to submit");
      const data = await response.json();
      setProblem("");
      setProblemOpen(false);
      setNotice("Problem saved. Your email draft to Lewis is opening.");
      window.location.href = data.mailtoUrl;
    } catch {
      setNotice("We couldn’t submit that report. Please try again.");
    } finally {
      setSendingProblem(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => nav("feed")} aria-label="Go to feed">
          <span className="brand-mark">g</span>
          <span>goodfind</span>
        </button>
        <div className="location-pill">
          <span className="pin-dot" />
          <span>Near Asheville, NC</span>
          <span className="chevron">⌄</span>
        </div>
        <div className="top-actions">
          <button className="icon-button" aria-label="Messages">↗</button>
          <button className="avatar-button" onClick={() => nav("profile")} aria-label="Open profile">
            LF
          </button>
        </div>
      </header>

      <main>
        {screen === "feed" && (
          <section className="feed-screen">
            <div className="feed-heading">
              <div>
                <p className="eyebrow">LOCAL FINDS, RIGHT NOW</p>
                <h1>Good stuff is closer than you think.</h1>
              </div>
              <label className="radius-control">
                <span>SHOWING WITHIN</span>
                <select value={radius} onChange={(event) => setRadius(event.target.value)}>
                  <option>2 miles</option>
                  <option>5 miles</option>
                  <option>10 miles</option>
                  <option>25 miles</option>
                </select>
              </label>
            </div>

            <div className="quick-row" aria-label="Sale categories">
              {["All nearby", "Open now", "Furniture", "Kids", "Vintage", "Tools"].map((item, index) => (
                <button
                  className={category === item ? "quick-chip active" : "quick-chip"}
                  key={item}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="search-row">
              <label>
                <span>⌕</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search furniture, tools, vintage..."
                  aria-label="Search nearby sales"
                />
              </label>
              <span>{filteredSales.length} sales near you</span>
            </div>

            <div className="sale-grid">
              {filteredSales.map((sale) => (
                <article className="sale-card" key={sale.id} onClick={() => setSelectedSale(sale)}>
                  <div className="card-image-wrap">
                    <img src={sale.image} alt="" className="card-image" />
                    <div className="distance-badge"><span className="pin-dot" /> {sale.distance}</div>
                    <button
                      className={`save-button ${saved.includes(sale.id) ? "saved" : ""}`}
                      onClick={(event) => { event.stopPropagation(); toggle(sale.id, saved, setSaved); }}
                      aria-label={saved.includes(sale.id) ? "Remove from saved sales" : "Save sale"}
                    >
                      {saved.includes(sale.id) ? "★" : "☆"}
                    </button>
                  </div>
                  <div className="card-body">
                    <div className="seller-row">
                      <span className="mini-avatar">{sale.avatar}</span>
                      <span>{sale.seller}</span>
                      <span className="area">{sale.area}</span>
                    </div>
                    <h2>{sale.title}</h2>
                    <p className="sale-time">{sale.time}</p>
                    <div className="tags">
                      {sale.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                    <div className="card-footer">
                      <button
                        className={liked.includes(sale.id) ? "liked" : ""}
                        onClick={(event) => { event.stopPropagation(); toggle(sale.id, liked, setLiked); }}
                      >
                        {liked.includes(sale.id) ? "♥" : "♡"} {sale.likes + (liked.includes(sale.id) ? 1 : 0)}
                      </button>
                      <button onClick={(event) => { event.stopPropagation(); setNotice(`Directions to ${sale.area} are ready.`); }}>
                        Get directions <span>→</span>
                      </button>
                    </div>
                  </div>
                </article>
              ))}
              {filteredSales.length === 0 && (
                <div className="no-results">
                  <strong>No sales match that search yet.</strong>
                  <p>Try a wider category or another item.</p>
                  <button onClick={() => { setQuery(""); setCategory("All nearby"); }}>Clear filters</button>
                </div>
              )}
            </div>
            <button className="map-fab" onClick={() => setMapOpen(true)}>
              <span>⌖</span> Map view
            </button>
          </section>
        )}

        {screen === "list" && (
          <section className="listing-screen">
            <div className="listing-intro">
              <p className="eyebrow">CREATE A SALE</p>
              <h1>Turn your clutter into someone&apos;s good find.</h1>
              <p>One simple listing. Seen by nearby shoppers. Live for up to 7 days.</p>
              <div className="price-lockup">
                <strong>$20</strong>
                <span>per garage sale listing<br />No subscription. No surprise fees.</span>
              </div>
              <div className="listing-benefits">
                <span>✓ Local feed placement</span>
                <span>✓ One clear sale photo</span>
                <span>✓ Directions & sharing</span>
              </div>
            </div>

            <div className="listing-card">
              <div className="progress-meta"><span>STEP {Math.min(step, 3)} OF 3</span><span>{progress} complete</span></div>
              <div className="progress-track"><span style={{ width: progress }} /></div>
              {step === 1 && (
                <div className="form-step">
                  <h2>Let&apos;s start with the basics</h2>
                  <p>Tell neighbors what makes your sale worth the stop.</p>
                  <label>SALE TITLE
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Huge family garage sale" />
                  </label>
                  <label>NEIGHBORHOOD OR ADDRESS
                    <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Your sale location" />
                  </label>
                  <label>START DATE
                    <input value={date} onChange={(e) => setDate(e.target.value)} type="date" />
                  </label>
                  <button className="primary-button" onClick={() => setStep(2)} disabled={!title || !location || !date}>
                    Add photos & details <span>→</span>
                  </button>
                </div>
              )}
              {step === 2 && (
                <div className="form-step">
                  <h2>Show off the good stuff</h2>
                  <p>Add one strong photo that shows shoppers what they can expect.</p>
                  <label className={`photo-drop ${photoPreview ? "has-photo" : ""}`}>
                    {photoPreview ? (
                      <>
                        <img src={photoPreview} alt="Selected garage sale" />
                        <span className="change-photo">Change photo</span>
                      </>
                    ) : (
                      <>
                        <span>＋</span>
                        <strong>Add one sale photo</strong>
                        <small>JPG, PNG, or WebP · 5 MB maximum</small>
                      </>
                    )}
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => choosePhoto(event.target.files?.[0])} />
                  </label>
                  <label>WHAT WILL PEOPLE FIND?
                    <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Furniture, tools, kids' clothes, vintage records..." />
                  </label>
                  <div className="step-actions">
                    <button className="text-button" onClick={() => setStep(1)}>← Back</button>
                    <button className="primary-button" onClick={() => setStep(3)}>Review listing →</button>
                  </div>
                </div>
              )}
              {step === 3 && (
                <div className="form-step review-step">
                  <div className="review-check">✓</div>
                  <h2>Your sale is ready to post</h2>
                  <div className="review-summary">
                    <span><small>SALE</small>{title}</span>
                    <span><small>LOCATION</small>{location}</span>
                    <span><small>PHOTO</small>{photo ? photo.name : "No photo selected"}</span>
                    <span><small>LISTING FEE</small>$20.00</span>
                  </div>
                  <p className="payment-note">Payment checkout is demonstrated here. A live version would connect secure payment before publishing.</p>
                  <button className="primary-button" onClick={() => setStep(4)}>
                    Continue to secure $20 checkout →
                  </button>
                  <button className="text-button center" onClick={() => setStep(2)}>← Edit details</button>
                </div>
              )}
              {step === 4 && !paid && (
                <div className="form-step checkout-step">
                  <p className="eyebrow">SECURE CHECKOUT</p>
                  <h2>Publish your sale</h2>
                  <div className="checkout-total"><span>One garage sale listing</span><strong>$20.00</strong></div>
                  <label>NAME ON CARD
                    <input value={cardName} onChange={(event) => setCardName(event.target.value)} placeholder="Full name" />
                  </label>
                  <label>CARD INFORMATION
                    <div className="fake-card-input"><span>•••• •••• •••• 4242</span><span>12/28 &nbsp; 123</span></div>
                  </label>
                  <button className="primary-button" disabled={!cardName || publishing} onClick={publishListing}>
                    {publishing ? "Publishing your sale..." : "Pay $20 & publish sale →"}
                  </button>
                  <p className="secure-note">▣ Secure payment · Your card details are protected</p>
                  <button className="text-button center" onClick={() => setStep(3)}>← Back to review</button>
                </div>
              )}
              {step === 4 && paid && (
                <div className="form-step review-step success-step">
                  <div className="review-check">✓</div>
                  <p className="eyebrow">YOU&apos;RE LIVE</p>
                  <h2>Your sale is now on goodfind.</h2>
                  <p>Nearby shoppers can discover, save, and get directions to your sale.</p>
                  <div className="live-listing-mini"><small>{userListing?.startDate ?? date}</small><strong>{userListing?.title ?? title}</strong><span>{userListing?.location ?? location}</span></div>
                  <button className="primary-button" onClick={() => nav("profile")}>Manage my listing →</button>
                </div>
              )}
            </div>
          </section>
        )}

        {screen === "profile" && (
          <section className="profile-screen">
            <div className="profile-header">
              <div className="profile-avatar">LF</div>
              <div>
                <p className="eyebrow">YOUR GOODFIND</p>
                <h1>Hey, Lewis.</h1>
                <p>Member since July 2026 · Asheville, NC</p>
              </div>
              <button className="outline-button">Edit profile</button>
            </div>
            <div className="stats-row">
              <div><strong>{saved.length}</strong><span>Saved sales</span></div>
              <div><strong>{userListing ? 1 : 0}</strong><span>Active listings</span></div>
              <div><strong>0</strong><span>Past sales</span></div>
            </div>
            <div className="profile-content">
              {userListing && (
                <div className="active-listing">
                  {userListing.photoUrl && <img className="active-listing-photo" src={userListing.photoUrl} alt="" />}
                  <div><p className="eyebrow">ACTIVE LISTING</p><h2>{userListing.title}</h2><span>{userListing.startDate} · {userListing.location}</span></div>
                  <div className="listing-metrics"><span><strong>{userListing.views}</strong>views</span><span><strong>{userListing.saves}</strong>saves</span><button onClick={() => setNotice("Your listing editor is ready.")}>Manage →</button></div>
                </div>
              )}
              <div className="section-title">
                <div><p className="eyebrow">YOUR COLLECTION</p><h2>Saved nearby</h2></div>
                <button onClick={() => nav("feed")}>Browse more →</button>
              </div>
              <div className="saved-strip">
                {sales.filter((sale) => saved.includes(sale.id)).map((sale) => (
                  <article className="saved-card" key={sale.id}>
                    <img src={sale.image} alt="" />
                    <div><span>{sale.distance} away</span><h3>{sale.title}</h3><p>{sale.time}</p></div>
                  </article>
                ))}
                {saved.length === 0 && <p className="empty-state">Save a nearby sale and it will appear here.</p>}
              </div>
            </div>
          </section>
        )}
      </main>

      <button className="problem-tab" onClick={() => setProblemOpen(true)}>
        <span>!</span> App problems?
      </button>

      {problemOpen && (
        <div className="problem-panel" role="dialog" aria-modal="true" aria-label="Report an app problem">
          <button className="problem-close" onClick={() => setProblemOpen(false)} aria-label="Close problem form">×</button>
          <p className="eyebrow">HELP US IMPROVE</p>
          <h2>Having an app problem?</h2>
          <p>Tell Lewis what happened. Your report is saved and an email draft addressed to <strong>owner@example.com</strong> will open.</p>
          <label>WHAT WENT WRONG?
            <textarea value={problem} onChange={(event) => setProblem(event.target.value)} maxLength={2000} placeholder="Describe what you were trying to do and what happened..." />
          </label>
          <div className="problem-count">{problem.length}/2000</div>
          <button className="primary-button" disabled={!problem.trim() || sendingProblem} onClick={submitProblem}>
            {sendingProblem ? "Submitting..." : "Submit problem →"}
          </button>
        </div>
      )}

      {selectedSale && (
        <div className="modal-backdrop" onClick={() => setSelectedSale(null)}>
          <article className="sale-modal" role="dialog" aria-modal="true" aria-label={selectedSale.title} onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedSale(null)} aria-label="Close sale details">×</button>
            <div className="modal-image"><img src={selectedSale.image} alt="" /><span>{selectedSale.distance} away</span></div>
            <div className="modal-content">
              <div className="seller-row"><span className="mini-avatar">{selectedSale.avatar}</span><span>{selectedSale.seller}</span><span className="area">Verified host</span></div>
              <h2>{selectedSale.title}</h2>
              <p className="modal-time">{selectedSale.time}</p>
              <p className="modal-description">{selectedSale.description}</p>
              <h3>A few featured finds</h3>
              <ul>{selectedSale.items.map((item) => <li key={item}>{item}</li>)}</ul>
              <div className="modal-location"><div className="tiny-map"><i /><i /><i /><b>●</b></div><div><small>SALE LOCATION</small><strong>{selectedSale.address}</strong><span>{selectedSale.area}, Asheville</span></div></div>
              <div className="modal-actions">
                <button className="outline-button" onClick={() => toggle(selectedSale.id, saved, setSaved)}>{saved.includes(selectedSale.id) ? "★ Saved" : "☆ Save sale"}</button>
                <button className="primary-button" onClick={() => setNotice(`Opening directions to ${selectedSale.address}.`)}>Get directions →</button>
              </div>
            </div>
          </article>
        </div>
      )}

      {mapOpen && (
        <div className="modal-backdrop" onClick={() => setMapOpen(false)}>
          <section className="map-panel" role="dialog" aria-modal="true" aria-label="Nearby sale map" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setMapOpen(false)} aria-label="Close map">×</button>
            <div className="map-canvas">
              <span className="road road-a" /><span className="road road-b" /><span className="road road-c" />
              {sales.map((sale, index) => <button key={sale.id} className={`map-pin pin-${index + 1}`} onClick={() => { setMapOpen(false); setSelectedSale(sale); }}><b>${index + 1}</b><span>{sale.distance}</span></button>)}
              <div className="you-pin">You</div>
            </div>
            <div className="map-drawer"><p className="eyebrow">3 SALES NEARBY</p><h2>Your neighborhood treasure map</h2><p>Tap a numbered pin to see sale details.</p></div>
          </section>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}

      <nav className="bottom-nav" aria-label="Main navigation">
        <button className={screen === "feed" ? "active" : ""} onClick={() => nav("feed")}><span>⌂</span>Feed</button>
        <button className={screen === "list" ? "active list-nav" : "list-nav"} onClick={() => nav("list")}><span>＋</span>List a sale</button>
        <button className={screen === "profile" ? "active" : ""} onClick={() => nav("profile")}><span>◎</span>Profile</button>
      </nav>
    </div>
  );
}
