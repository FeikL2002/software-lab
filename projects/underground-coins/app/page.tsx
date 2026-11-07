"use client";

import { useEffect, useState } from "react";

const DRAWING_TIME = new Date("2026-07-31T20:00:00-04:00").getTime();

function getTimeLeft() {
  const distance = Math.max(0, DRAWING_TIME - Date.now());
  return {
    days: Math.floor(distance / 86_400_000),
    hours: Math.floor((distance / 3_600_000) % 24),
    minutes: Math.floor((distance / 60_000) % 60),
    seconds: Math.floor((distance / 1_000) % 60),
  };
}

export default function Home() {
  const [timeLeft, setTimeLeft] = useState(getTimeLeft);

  useEffect(() => {
    const timer = window.setInterval(() => setTimeLeft(getTimeLeft()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main>
      <nav className="nav">
        <a className="brand" href="#top" aria-label="Underground Coins home">
          <span className="coin-mark">UC</span>
          <span>UNDERGROUND COINS</span>
        </a>
        <a className="nav-link" href="#details">PRIZE DETAILS</a>
      </nav>

      <section className="hero" id="top">
        <div className="noise" />
        <div className="hero-copy">
          <p className="eyebrow"><span /> ONE WINNER. ONE LEGENDARY NIGHT.</p>
          <h1>SEE <em>LEBRON</em><br />IN BOSTON.</h1>
          <p className="subhead">
            Win four tickets to the October 10, 2026 preseason game plus a hotel stay.
            Your entire crew. One unforgettable night.
          </p>
          <div className="price-row">
            <div className="price"><sup>$</sup>2</div>
            <div className="price-copy">PER ENTRY<br /><span>NO LIMIT. MORE ENTRIES, MORE CHANCES.</span></div>
          </div>
          <a
            className="enter-button"
            href="https://example.invalid/checkout"
            target="_blank"
            rel="noopener noreferrer"
          >
            ENTER NOW — $2 <span>→</span>
          </a>
          <p className="secure-note">Secure checkout powered by Stripe</p>
        </div>

        <div className="ticket-stage" aria-label="Prize includes four game tickets and a hotel stay">
          <div className="glow" />
          <img className="sixers-logo" src="/76ers-logo.svg" alt="Philadelphia 76ers" />
          <div className="jersey" aria-label="LeBron James Philadelphia number 23 jersey">
            <div className="jersey-neck" />
            <span className="jersey-city">PHILA</span>
            <strong>23</strong>
            <span className="jersey-name">JAMES</span>
          </div>
          <div className="ticket ticket-back">
            <span>UNDERGROUND COINS</span><strong>ADMIT ONE</strong>
          </div>
          <div className="ticket ticket-front">
            <div className="ticket-top">
              <span>PRESEASON • OCT 10, 2026</span><b>76</b>
            </div>
            <div className="ticket-main">
              <small>THE KING COMES TO BOSTON</small>
              <strong>4×</strong>
              <span>GAME TICKETS</span>
            </div>
            <div className="ticket-stub">
              <span>PLUS</span><strong>HOTEL STAY</strong>
            </div>
          </div>
          <p className="package-label">THE ULTIMATE BOSTON GAME NIGHT PACKAGE</p>
        </div>
      </section>

      <section className="countdown-wrap" aria-label="Drawing countdown">
        <p>DRAWING CLOSES FRIDAY, JULY 31 AT 8:00 PM ET</p>
        <div className="countdown">
          {Object.entries(timeLeft).map(([label, value]) => (
            <div className="time-block" key={label}>
              <strong>{String(value).padStart(2, "0")}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="details" id="details">
        <p className="eyebrow"><span /> WHAT YOU COULD WIN</p>
        <h2>ONE ENTRY COULD<br />CHANGE YOUR <em>WEEKEND.</em></h2>
        <div className="detail-grid">
          <article>
            <span className="number">01</span>
            <h3>FOUR GAME TICKETS</h3>
            <p>Bring your crew to the preseason game in Boston on October 10, 2026.</p>
          </article>
          <article>
            <span className="number">02</span>
            <h3>HOTEL STAY</h3>
            <p>Make a night of it with an included hotel stay for the winning party.</p>
          </article>
          <article>
            <span className="number">03</span>
            <h3>$2 TO ENTER</h3>
            <p>Every $2 purchase counts as one entry in the drawing.</p>
          </article>
        </div>
        <p className="legal">
          No purchase option, official rules, eligibility, prize details, and drawing method will be
          published before entries open. Not affiliated with the Philadelphia 76ers, the NBA, or LeBron James.
        </p>
      </section>
    </main>
  );
}
