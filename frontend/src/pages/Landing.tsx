"use client";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Graph,
  Fingerprint,
  Scan,
  FileText,
  ShieldCheck,
  List,
  X,
  Plus,
  Minus,
  UploadSimple,
  Path,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { Brand, Reveal, ThemeButton } from "../components/UI";
import { useWorkspace } from "../lib/state/workspace";
import { useAuth } from "../lib/auth";
const questions = [
  [
    "What can I investigate?",
    "Explore relationships between people, vehicles and locations. Import call records, contact lists or financial relationships, then review graph connections, communities and explainable alerts.",
  ],
  [
    "Can I use my own data locally?",
    "Yes. Choose On this device for browser analysis, or Connected backend to use the Python analysis service. Both produce graphs, rankings, communities and review flags. A separate fictional demo is available.",
  ],
  [
    "Does an alert mean someone is guilty?",
    "No. Alerts identify patterns that deserve review. They are investigation leads, never verdicts. Always examine the evidence and provenance before drawing conclusions.",
  ],
  [
    "Which files can I upload?",
    "Upload CSV, XLSX, XLS or relationship JSON. Preview and adjust the column mapping before loading data. Document Intel accepts pasted text and plain-text reports.",
  ],
  [
    "Where does my data go?",
    "Connected backend sends submitted evidence to this website’s server for processing without retaining it. On this device keeps analysis in your browser. Results, watchlists and notes are saved in this browser. Clearing site data removes saved investigations.",
  ],
];
export default function Landing() {
  const [open, setOpen] = useState(false);
  const [faq, setFaq] = useState<number | null>(0);
  const { setMode } = useWorkspace();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [accountOpen, setAccountOpen] = useState(false);
  const reduce = useReducedMotion();
  const demo = () => setMode("demo");
  return (
    <div className="marketing">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-nav">
        <div className="site-container nav-inner">
          <Brand />
          <nav className={open ? "site-links open" : "site-links"}>
            <a href="#platform" onClick={() => setOpen(false)}>
              Platform
            </a>
            <a href="#workflow" onClick={() => setOpen(false)}>
              How it works
            </a>
            <a href="#questions" onClick={() => setOpen(false)}>
              Questions
            </a>
          </nav>
          <div className="site-nav-actions">
            <ThemeButton />
            {user ? <div className="account-menu landing-account"><button className="analyst-avatar account-avatar landing-avatar" aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>{user.user_metadata?.avatar_url || user.user_metadata?.picture ? <img src={user.user_metadata.avatar_url || user.user_metadata.picture} alt="Your profile" /> : (user.email?.slice(0, 2).toUpperCase() || "ME")}</button>{accountOpen && <div className="account-popover"><strong>{user.user_metadata?.full_name || user.email?.split("@")[0]}</strong><small>{user.email}</small><Link to="/investigations" onClick={() => setAccountOpen(false)}>Past investigations</Link><button onClick={() => { setAccountOpen(false); void signOut(); }}>Sign out</button></div>}</div> : <Link className="btn nav-login" to="/signin" onClick={(event) => { event.preventDefault(); navigate("/signin"); }}>Sign in</Link>}
            <Link className="btn nav-cta" to="/upload">
              Open workspace <ArrowUpRight size={16} />
            </Link>
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle menu"
              onClick={() => setOpen(!open)}
            >
              {open ? <X /> : <List />}
            </button>
          </div>
        </div>
      </header>
      <main id="main-content">
        <section className="landing-hero">
          <div className="hero-image-wrap">
            <motion.img
              initial={reduce ? false : { scale: 1.04 }}
              animate={{ scale: 1 }}
              transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
              src="/images/investigation.webp"
              srcSet="/images/investigation-mobile.webp 768w, /images/investigation.webp 1536w"
              sizes="(max-width: 767px) 100vw, 65vw"
              alt="Magnifying glass examining fingerprint evidence beside connected case records"
              width="1536"
              height="1024"
              fetchPriority="high"
            />
          </div>
          <div className="site-container hero-content">
            <Reveal>
              <div className="hero-eyebrow">
                <Fingerprint size={17} /> INVESTIGATION, CONNECTED
              </div>
              <h1>
                Find the story.
                <br />
                Follow the evidence.
              </h1>
              <p>
                Turn fragmented records into connected intelligence. See
                relationships, trace patterns, and move your investigation
                forward.
              </p>
              <div className="hero-actions">
                <Link
                  className="btn primary large"
                  to="/overview"
                  onClick={demo}
                >
                  Explore demo <ArrowRight size={19} />
                </Link>
                <a className="btn large" href="#platform">
                  Discover the platform <ArrowUpRight size={19} />
                </a>
                <Link className="text-link" to="/signin">
                  Sign in with Google <ArrowRight size={17} />
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
        <section className="platform-intro site-container" id="platform">
          <Reveal>
            <div className="intro-rule" />
            <h2>
              The bigger picture.
              <br />
              <span className="secondary-text">Every connection counts.</span>
            </h2>
            <p>
              One workspace to move from raw evidence to a clearer understanding
              of the network.
            </p>
          </Reveal>
          <div className="capability-grid">
            <Reveal className="capability-card network-feature">
              <div className="feature-heading">
                <Graph size={28} weight="thin" />
                <ArrowUpRight size={20} />
              </div>
              <div className="network-visual" aria-hidden="true">
                <div className="network-orbit orbit-one" />
                <div className="network-orbit orbit-two" />
                <div className="network-orbit orbit-three" />
                <span className="orbit-center">
                  <Graph size={40} weight="thin" />
                </span>
              </div>
              <div className="feature-copy">
                <h3>Follow every connection.</h3>
                <p>
                  Explore the graph, isolate a neighbourhood, and find paths
                  between entities.
                </p>
                <Link to="/network" onClick={demo} className="text-link">
                  Network Explorer <ArrowRight size={16} />
                </Link>
              </div>
            </Reveal>
            <div className="capability-side">
              <Reveal className="capability-card evidence-feature" delay={0.08}>
                <img
                  src="/images/evidence.webp"
                  width="1536"
                  height="1024"
                  alt="Layered translucent evidence sheets"
                  loading="lazy"
                />
                <div className="feature-copy">
                  <FileText size={25} weight="thin" />
                  <h3>Give evidence context.</h3>
                  <p>
                    Extract names and relationships from reports. Keep your
                    source material in view.
                  </p>
                  <Link to="/documents" className="text-link">
                    Document Intel <ArrowRight size={16} />
                  </Link>
                </div>
              </Reveal>
              <Reveal className="capability-card signal-feature" delay={0.12}>
                <ShieldCheck size={29} weight="thin" />
                <div className="feature-copy">
                  <h3>A signal. Not a verdict.</h3>
                  <p>
                    Understand why a pattern was flagged, then decide what
                    deserves a closer look.
                  </p>
                  <Link to="/alerts" onClick={demo} className="text-link">
                    Review alerts <ArrowRight size={16} />
                  </Link>
                </div>
              </Reveal>
            </div>
          </div>
        </section>
        <section className="workflow-section" id="workflow">
          <div className="site-container">
            <Reveal>
              <h2>
                From scattered records
                <br />
                to a focused investigation.
              </h2>
            </Reveal>
            <div className="workflow-rows">
              {[
                {
                  icon: UploadSimple,
                  title: "Bring your evidence.",
                  body: "Upload your dataset. Check the detected columns and review the cleaned records before they enter the graph.",
                  link: "/upload",
                  cta: "Import data",
                },
                {
                  icon: Path,
                  title: "Make the connections.",
                  body: "Search entities, trace paths and discover communities. See who connects the network and where to look next.",
                  link: "/network",
                  cta: "Explore the network",
                },
                {
                  icon: Scan,
                  title: "Build your perspective.",
                  body: "Review supporting evidence, save entities to your watchlist, and export a summary with your analyst notes.",
                  link: "/reports",
                  cta: "Build a report",
                },
              ].map((step, i) => (
                <Reveal
                  key={step.title}
                  className="workflow-row"
                  delay={i * 0.06}
                >
                  <step.icon size={32} weight="thin" />
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                  <Link
                    className="round-link"
                    to={step.link}
                    onClick={demo}
                    aria-label={step.cta}
                  >
                    <ArrowUpRight size={24} />
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
        <section className="principle-section site-container">
          <Reveal className="principle-copy">
            <ShieldCheck size={36} weight="thin" />
            <h2>
              Technology finds patterns.
              <br />
              <span className="secondary-text">Judgment stays human.</span>
            </h2>
            <p>
              Every connection needs context. X-Tracer helps you ask better
              questions, review evidence, and document your reasoning.
            </p>
            <div className="principle-tags">
              <span>Explainable signals</span>
              <span>Evidence-led analysis</span>
              <span>Analyst control</span>
            </div>
          </Reveal>
        </section>
        <section className="faq-section site-container" id="questions">
          <Reveal>
            <h2>A little more clarity.</h2>
            <div className="faq-list">
              {questions.map(([q, a], i) => (
                <div className="faq-item" key={q}>
                  <button
                    aria-expanded={faq === i}
                    aria-controls={`faq-${i}`}
                    onClick={() => setFaq(faq === i ? null : i)}
                  >
                    {q}
                    {faq === i ? <Minus size={18} /> : <Plus size={18} />}
                  </button>
                  {faq === i && <p id={`faq-${i}`}>{a}</p>}
                </div>
              ))}
            </div>
          </Reveal>
        </section>
        <section className="closing-section site-container">
          <Reveal>
            <h2>
              Your next lead
              <br />
              starts with a connection.
            </h2>
            <Link className="btn primary large" to="/overview" onClick={demo}>
              Explore demo <ArrowRight size={20} />
            </Link>
          </Reveal>
        </section>
      </main>
      <footer className="site-footer site-container">
        <Brand />
        <p>From evidence to intelligence.</p>
        <div>
          <Link to="/upload">Use your own data</Link>
          <Link to="/upload">
            Open workspace <ArrowUpRight size={14} />
          </Link>
        </div>
        <span className="footer-note">
          X-Tracer is an investigation aid. Findings require human review.
        </span>
      </footer>
    </div>
  );
}
