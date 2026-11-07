"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type ClubProfile = {
  name: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  schedule: string;
  bio: string;
  programs: string[];
  logo?: string;
  photos?: string[];
};

const PROGRAMS = ["Youth wrestling", "Middle school", "High school", "Girls wrestling", "Freestyle & Greco", "Adult / open mat"];

const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55) || "your-wrestling-club";

const fileToDataUrl = (file?: File) =>
  new Promise<string>((resolve) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });

const encodeProfile = (profile: ClubProfile) =>
  btoa(unescape(encodeURIComponent(JSON.stringify({ ...profile, logo: "", photos: [] }))));

const decodeProfile = (value: string): ClubProfile =>
  JSON.parse(decodeURIComponent(escape(atob(value))));

export default function Home() {
  const [clubName, setClubName] = useState("");
  const [programs, setPrograms] = useState<string[]>([]);
  const [profile, setProfile] = useState<ClubProfile | null>(null);
  const [shared, setShared] = useState(false);
  const slug = useMemo(() => slugify(clubName), [clubName]);

  useEffect(() => {
    try {
      const match = window.location.hash.match(/^#club=(.+)$/);
      if (match) {
        setProfile(decodeProfile(match[1]));
        setShared(true);
        setTimeout(() => document.querySelector("#preview")?.scrollIntoView(), 50);
        return;
      }
      const saved = localStorage.getItem("matconnect-profile");
      if (saved) setProfile(JSON.parse(saved));
    } catch {
      window.location.hash = "";
    }
  }, []);

  const toggleProgram = (program: string) => {
    setPrograms((current) => {
      if (current.includes(program)) return current.filter((item) => item !== program);
      if (current.length === 4) {
        alert("Choose up to four programs.");
        return current;
      }
      return [...current, program];
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const photoFiles = (data.getAll("photos") as File[]).filter((file) => file.size).slice(0, 5);
    const next: ClubProfile = {
      name: String(data.get("name") || "").trim(),
      city: String(data.get("city") || "").trim(),
      phone: String(data.get("phone") || "").trim(),
      email: String(data.get("email") || "").trim(),
      website: String(data.get("website") || "").trim(),
      schedule: String(data.get("schedule") || "").trim(),
      bio: String(data.get("bio") || "").trim(),
      programs,
      logo: await fileToDataUrl(data.get("logo") as File),
      photos: await Promise.all(photoFiles.map(fileToDataUrl)),
    };
    setProfile(next);
    localStorage.setItem("matconnect-profile", JSON.stringify(next));
    setTimeout(() => document.querySelector("#preview")?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const share = async () => {
    if (!profile) return;
    const url = `${location.origin}${location.pathname}#club=${encodeProfile(profile)}`;
    try {
      await navigator.clipboard.writeText(url);
      alert("Your club link is copied and ready to share.");
    } catch {
      prompt("Copy your club link:", url);
    }
  };

  return (
    <>
      <header className="nav">
        <a className="brand" href="#top"><i>MC</i><span>MatConnect<small>by AmericanSites.us</small></span></a>
        <nav><a href="#how">How it works</a><a href="#website">Website offer</a></nav>
        <a className="navCta" href="#builder">Create your club page ↗</a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="heroCopy">
            <p className="eyebrow">Built for wrestling clubs</p>
            <h1>Put your club <em>on the map.</em></h1>
            <p className="lead">Create one sharp, shareable page where wrestlers and parents can learn about your programs, practice schedule, coaches, and how to join.</p>
            <div className="actions"><a className="primary" href="#builder">Create your club page ↓</a><a className="ghost" href="#how">See how it works</a></div>
            <p className="micro"><strong>Made for local wrestling.</strong> Easy to build. Easy to share.</p>
          </div>
          <div className="heroArt" aria-label="Sample wrestling club profile">
            <div className="matLines" />
            <article className="sampleCard">
              <div className="sampleCover"><span>CLUB PROFILE</span><b>EST. 2014</b></div>
              <div className="sampleBody"><b className="sampleLogo">RT</b><small>AKRON, OH</small><h2>Ridgeway Titans Wrestling</h2><p>Youth · Girls · Freestyle &amp; Greco</p><div><mark>USA WRESTLING</mark><mark>ALL LEVELS</mark></div><button>Request a trial practice ↗</button></div>
            </article>
          </div>
        </section>

        <section className="benefits">
          <div><b>01</b><span><strong>A trusted club page</strong><small>Give families one clear first impression.</small></span></div>
          <div><b>02</b><span><strong>Programs &amp; schedule</strong><small>Make the next practice easy to find.</small></span></div>
          <div><b>03</b><span><strong>Up to 5 club photos</strong><small>Show your room, team, and culture.</small></span></div>
          <div><b>04</b><span><strong>Easy social sharing</strong><small>Post one link everywhere.</small></span></div>
        </section>

        <section className="darkSection" id="how">
          <p className="sectionTag">01 / HOW IT WORKS</p>
          <div className="sectionIntro"><h2>From word of mouth to<br /><em>ready to recruit.</em></h2><p>No complicated setup. Just the information wrestlers and parents need before they walk into the room.</p></div>
          <div className="steps">
            <article><b>01</b><i>01</i><h3>Tell us about your club</h3><p>Add your location, contact details, programs, practice schedule, and a short club bio.</p></article>
            <article><b>02</b><i>02</i><h3>Show your room</h3><p>Upload your club logo and up to five photos of practices, coaches, competition, or your facility.</p></article>
            <article><b>03</b><i>03</i><h3>Share your page</h3><p>Create one link for social media, tournament flyers, school handouts, and parent messages.</p></article>
          </div>
        </section>

        <section className="offer" id="website">
          <p className="sectionTag">02 / GROW WITH AMERICANSITES</p>
          <div className="sectionIntro"><h2>Ready for your club&apos;s<br /><em>own website?</em></h2><p>Your free club page gets you started. AmericanSites can build and support a complete home for your wrestling program.</p></div>
          <article className="offerCard">
            <div>
              <a className="asButton" href="https://americansites.us/" target="_blank" rel="noopener">Visit AmericanSites.us ↗</a>
              <h3>Your wrestling website, built by AmericanSites</h3>
              <p className="price">$200 <small>one-time build</small></p>
              <p className="monthly">+ $40 <small>/ month</small></p>
              <p>Hosting, updates, and ongoing website support are included in the monthly plan.</p>
            </div>
            <div className="offerList">
              <b>FREE CLUB DOMAIN INCLUDED</b>
              <h3>Recruit. Inform. Grow.</h3>
              <p>Give families a permanent place for registration, schedules, coaching staff, announcements, sponsors, and club contact.</p>
              <ul><li>Free club domain</li><li>Custom mobile-first website</li><li>Registration and inquiry system</li><li>Schedules, coaches, and sponsors</li><li>Hosting and ongoing support</li></ul>
              <a href="https://americansites.us/#contact" target="_blank" rel="noopener">Start your club website ↗</a>
            </div>
          </article>
        </section>

        {!shared && <section className="builder" id="builder">
          <div className="builderIntro"><p className="sectionTag">CREATE YOUR PAGE</p><h2>Build the page families will <em>visit.</em></h2><p>Add the essentials, show what makes your room special, and create a club-ready page.</p><div className="address">YOUR CLUB PAGE<strong>{slug}</strong></div></div>
          <form onSubmit={submit}>
            <div className="fields">
              <label><span>Club name *</span><input name="name" required placeholder="Ridgeway Titans Wrestling" value={clubName} onChange={(e) => setClubName(e.target.value)} /></label>
              <label><span>City &amp; state *</span><input name="city" required placeholder="Akron, OH" /></label>
              <label><span>Phone *</span><input name="phone" required type="tel" placeholder="(555) 555-5555" /></label>
              <label><span>Email *</span><input name="email" required type="email" placeholder="coach@yourclub.com" /></label>
              <label><span>Club website <small>(optional)</small></span><input name="website" type="url" placeholder="https://yourclub.com" /></label>
              <label><span>Practice schedule *</span><input name="schedule" required placeholder="Mon & Wed, 6:00–7:30 PM" /></label>
            </div>
            <fieldset><legend>Programs <small>Choose up to 4</small></legend><div className="serviceChoices">
              {PROGRAMS.map((program) => <label key={program}><input type="checkbox" checked={programs.includes(program)} onChange={() => toggleProgram(program)} /><span>{program}</span></label>)}
            </div></fieldset>
            <label><span>About your club *</span><textarea name="bio" required maxLength={500} placeholder="Tell families about your coaches, culture, experience level, and what makes your wrestling room special." /></label>
            <div className="uploads"><label><b>＋ Add your logo</b><small>PNG or JPG</small><input name="logo" type="file" accept="image/*" /></label><label><b>＋ Add club photos</b><small>Up to 5 images</small><input name="photos" type="file" accept="image/*" multiple /></label></div>
            <label className="human"><input type="checkbox" required /><i /><span><strong>I confirm this is a real club</strong><small>I&apos;m creating this page for a wrestling program.</small></span></label>
            <button className="publish" type="submit">Create my club page ↗</button>
          </form>
        </section>}

        {profile && <section className="previewWrap" id="preview">
          <div className="previewTop"><div><p className="sectionTag">{shared ? "WRESTLING CLUB PAGE" : "YOUR PAGE IS READY"}</p><h2>{shared ? profile.name : <>Preview your <em>club page.</em></>}</h2></div>{!shared && <div><button onClick={share}>Copy my share link</button><button onClick={() => navigator.clipboard.writeText(`${profile.name}\n${profile.city}\n${profile.phone}\n${profile.email}\n${profile.schedule}\n${profile.bio}`)}>Copy club details</button></div>}</div>
          <article className="clientPreview">
            <div className="cpCover">{profile.photos?.[0] && <img src={profile.photos[0]} alt={`${profile.name} wrestling`} />}<span>WRESTLING CLUB PROFILE</span></div>
            <div className="cpBody">
              {profile.logo ? <img className="cpLogo" src={profile.logo} alt={`${profile.name} logo`} /> : <div className="cpLogo">{profile.name.slice(0, 2).toUpperCase()}</div>}
              <h2>{profile.name}</h2><p className="cpLocation">◎ {profile.city}</p>
              <div className="cpTags">{profile.programs.map((program) => <span key={program}>{program}</span>)}</div>
              <div className="schedule"><small>NEXT STEP</small><strong>{profile.schedule}</strong></div>
              <p className="cpBio">{profile.bio}</p>
              {profile.photos && profile.photos.length > 1 && <div className="cpGallery">{profile.photos.slice(1).map((photo, index) => <img src={photo} alt={`${profile.name} club photo ${index + 2}`} key={index} />)}</div>}
              <div className="cpActions"><a href={`tel:${profile.phone}`}>Call {profile.phone}</a><a href={`mailto:${profile.email}?subject=${encodeURIComponent(`Trial practice request for ${profile.name}`)}`}>Request a trial practice ↗</a>{profile.website && <a href={profile.website} target="_blank" rel="noopener">Visit club website ↗</a>}</div>
            </div>
          </article>
        </section>}
      </main>
      <footer><div className="brand"><i>MC</i><span>MatConnect<small>by AmericanSites.us</small></span></div><p>A simple online home for independent wrestling clubs.</p><a href="https://americansites.us/" target="_blank" rel="noopener">AmericanSites.us ↗</a></footer>
    </>
  );
}
