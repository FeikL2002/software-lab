"use client";

import { useMemo, useState } from "react";

type Listing = {
  id: number;
  title: string;
  price: number;
  location: string;
  distance: number;
  condition: string;
  category: string;
  image: string;
  seller: string;
  verified?: boolean;
  note?: string;
};

const listings: Listing[] = [
  { id: 1, title: "Oak pedestal dining table", price: 340, location: "Greenpoint", distance: 1.2, condition: "Excellent", category: "Tables", image: "https://images.unsplash.com/photo-1577140917170-285929fb55b7?auto=format&fit=crop&w=1000&q=85", seller: "Maya R.", verified: true, note: "Seats six comfortably" },
  { id: 2, title: "Bouclé accent chair", price: 185, location: "Williamsburg", distance: 2.4, condition: "Like new", category: "Chairs", image: "https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?auto=format&fit=crop&w=1000&q=85", seller: "Jon Bell", verified: true, note: "No stains or wear" },
  { id: 3, title: "Low-profile linen sofa", price: 620, location: "Fort Greene", distance: 3.1, condition: "Good", category: "Sofas", image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=1000&q=85", seller: "Camille S.", note: "Elevator building" },
  { id: 4, title: "Vintage teak sideboard", price: 475, location: "Park Slope", distance: 4.8, condition: "Vintage", category: "Storage", image: "https://images.unsplash.com/photo-1595515106969-1ce29566ff1c?auto=format&fit=crop&w=1000&q=85", seller: "Hannah Lee", verified: true, note: "Beautiful original hardware" },
  { id: 5, title: "Travertine coffee table", price: 290, location: "Bed-Stuy", distance: 2.8, condition: "Excellent", category: "Tables", image: "https://images.unsplash.com/photo-1532372320572-cda25653a694?auto=format&fit=crop&w=1000&q=85", seller: "Andre M.", note: "Very heavy—bring two people" },
  { id: 6, title: "Cane nightstand pair", price: 160, location: "Clinton Hill", distance: 3.6, condition: "Like new", category: "Bedroom", image: "https://images.unsplash.com/photo-1595428774223-ef52624120d2?auto=format&fit=crop&w=1000&q=85", seller: "Priya K.", verified: true, note: "Sold as a pair" },
  { id: 7, title: "Walnut writing desk", price: 225, location: "Bushwick", distance: 4.2, condition: "Good", category: "Desks", image: "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?auto=format&fit=crop&w=1000&q=85", seller: "Theo G.", note: "Cable slot in back" },
  { id: 8, title: "Sculptural floor lamp", price: 95, location: "Cobble Hill", distance: 5.0, condition: "Excellent", category: "Lighting", image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=1000&q=85", seller: "Elena P.", verified: true, note: "Warm white bulb included" },
];

const categories = [
  ["All", "✦"], ["Sofas", "⌁"], ["Tables", "◉"], ["Chairs", "◒"],
  ["Storage", "▤"], ["Bedroom", "▰"], ["Desks", "⌑"], ["Lighting", "☼"],
];

export default function Home() {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("Recommended");
  const [saved, setSaved] = useState<number[]>([]);
  const [selected, setSelected] = useState<Listing | null>(null);
  const [sellOpen, setSellOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const visible = useMemo(() => {
    const result = listings.filter((item) =>
      (category === "All" || item.category === category) &&
      item.title.toLowerCase().includes(query.toLowerCase())
    );
    if (sort === "Price: low to high") return [...result].sort((a, b) => a.price - b.price);
    if (sort === "Nearest first") return [...result].sort((a, b) => a.distance - b.distance);
    return result;
  }, [category, query, sort]);

  const toggleSave = (id: number) =>
    setSaved((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);

  return (
    <main>
      <header className="topbar">
        <a href="#" className="brand" aria-label="Furnishly home"><span>F</span>Furnishly</a>
        <div className="location"><span>●</span><div><small>Browsing near</small><strong>Brooklyn, NY</strong></div><b>⌄</b></div>
        <nav>
          <button className="nav-link" onClick={() => document.getElementById("listings")?.scrollIntoView({ behavior: "smooth" })}>Browse</button>
          <button className="nav-link saved-link" onClick={() => { setCategory("All"); setQuery(""); document.getElementById("listings")?.scrollIntoView({ behavior: "smooth" }); }}>Saved {saved.length > 0 && <em>{saved.length}</em>}</button>
          <button className="avatar" aria-label="Open profile">LF</button>
          <button className="sell-button" onClick={() => { setSellOpen(true); setSubmitted(false); }}>＋ Sell furniture</button>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Furniture deserves a second home</p>
          <h1>Find something<br /><i>worth keeping.</i></h1>
          <p className="subhead">Beautiful furniture from people nearby. No shipping, no mystery—just great pieces ready for their next room.</p>
          <div className="search">
            <span>⌕</span>
            <input aria-label="Search furniture" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What are you looking for?" />
            <button onClick={() => document.getElementById("listings")?.scrollIntoView({ behavior: "smooth" })}>Search</button>
          </div>
          <div className="trust-row"><span>✓ Local pickup only</span><span>✓ Real people, real homes</span><span>✓ No hidden fees</span></div>
        </div>
        <div className="hero-image" role="img" aria-label="A warm living room with a green sofa">
          <div className="hero-stamp"><span>2,400+</span> pieces nearby</div>
          <div className="floating-card">
            <div><small>Just listed · 0.8 mi</small><strong>Vintage lounge chair</strong></div>
            <b>$140</b>
          </div>
        </div>
      </section>

      <section className="category-wrap" aria-label="Furniture categories">
        {categories.map(([name, icon]) => (
          <button key={name} className={category === name ? "category active" : "category"} onClick={() => setCategory(name)}>
            <span>{icon}</span>{name}
          </button>
        ))}
      </section>

      <section className="market" id="listings">
        <div className="section-heading">
          <div><p className="eyebrow">Fresh finds near you</p><h2>{category === "All" ? "Furniture worth leaving home for" : `${category} nearby`}</h2></div>
          <div className="filter-row">
            <button className="filter">Within 10 miles⌄</button>
            <select aria-label="Sort listings" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option>Recommended</option><option>Nearest first</option><option>Price: low to high</option>
            </select>
          </div>
        </div>

        <div className="listing-grid">
          {visible.map((item) => (
            <article className="listing" key={item.id}>
              <button className="image-button" onClick={() => setSelected(item)} aria-label={`View ${item.title}`}>
                <img src={item.image} alt={item.title} />
                <span className="condition">{item.condition}</span>
              </button>
              <button className={saved.includes(item.id) ? "heart saved" : "heart"} onClick={() => toggleSave(item.id)} aria-label="Save listing">{saved.includes(item.id) ? "♥" : "♡"}</button>
              <div className="listing-copy" onClick={() => setSelected(item)}>
                <div className="price">${item.price}</div>
                <h3>{item.title}</h3>
                <p>{item.location} · {item.distance} mi away</p>
              </div>
            </article>
          ))}
        </div>
        {visible.length === 0 && <div className="empty"><span>⌕</span><h3>No pieces found</h3><p>Try another search or browse all furniture.</p><button onClick={() => { setQuery(""); setCategory("All"); }}>Show everything</button></div>}
      </section>

      <section className="sell-banner">
        <div><p className="eyebrow">Make space. Make money.</p><h2>Your old favorite could be<br />someone’s new favorite.</h2><p>List in under two minutes and reach serious local buyers.</p></div>
        <div className="launch-card"><span>FREE</span><strong>while we launch</strong><small>Then just $2 per listing.<br />No commission when it sells.</small><button onClick={() => { setSellOpen(true); setSubmitted(false); }}>List a piece →</button></div>
      </section>

      <footer>
        <a href="#" className="brand light"><span>F</span>Furnishly</a>
        <p>Better rooms. Less waste. Closer to home.</p>
        <div><a href="#">How it works</a><a href="#">Safety</a><a href="#">Community</a><a href="#">Help</a></div>
        <small>© 2026 Furnishly · Made for neighbors</small>
      </footer>

      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
          <section className="detail-modal" onMouseDown={(e) => e.stopPropagation()} aria-modal="true" role="dialog">
            <button className="close" onClick={() => setSelected(null)}>×</button>
            <img src={selected.image} alt={selected.title} />
            <div className="detail-copy">
              <p className="eyebrow">{selected.condition} · {selected.distance} miles away</p>
              <h2>{selected.title}</h2><div className="detail-price">${selected.price}</div>
              <p className="note">{selected.note}. Local pickup in {selected.location}.</p>
              <div className="seller"><span>{selected.seller.split(" ").map(x => x[0]).join("")}</span><div><strong>{selected.seller} {selected.verified && "✓"}</strong><small>Responds within an hour</small></div></div>
              <button className="message-button" onClick={() => alert(`Message started with ${selected.seller}`)}>Message seller</button>
              <button className="save-detail" onClick={() => toggleSave(selected.id)}>{saved.includes(selected.id) ? "♥ Saved" : "♡ Save for later"}</button>
              <small className="safety">Meet in a public place when possible. Never send a deposit before seeing an item.</small>
            </div>
          </section>
        </div>
      )}

      {sellOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSellOpen(false)}>
          <section className="sell-modal" onMouseDown={(e) => e.stopPropagation()} aria-modal="true" role="dialog">
            <button className="close" onClick={() => setSellOpen(false)}>×</button>
            {!submitted ? <>
              <p className="eyebrow">List your furniture</p><h2>Give it a second home.</h2>
              <div className="progress"><span></span><i></i><i></i></div>
              <form onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}>
                <label>What are you selling?<input required placeholder="e.g. Mid-century walnut dresser" /></label>
                <div className="form-row"><label>Price<input required type="number" placeholder="$ 0" /></label><label>Category<select required><option>Choose one</option><option>Sofas</option><option>Tables</option><option>Chairs</option><option>Storage</option></select></label></div>
                <label>Condition<select required><option>Like new</option><option>Excellent</option><option>Good</option><option>Well loved</option></select></label>
                <label>Description<textarea placeholder="Dimensions, materials, pickup notes..." /></label>
                <div className="fee-note"><b>$0 today</b><span>Listings are free during launch. Later, it’ll be a simple $2 flat fee—never a sales commission.</span></div>
                <button className="continue" type="submit">Continue to photos →</button>
              </form>
            </> : <div className="success"><span>✓</span><h2>Great start!</h2><p>Your listing details are saved. In the full version, you’ll add photos and choose a pickup area next.</p><button onClick={() => setSellOpen(false)}>Done</button></div>}
          </section>
        </div>
      )}
    </main>
  );
}
