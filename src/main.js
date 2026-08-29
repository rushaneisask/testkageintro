import "./style.css";
import gsap from "gsap";
import { World } from "./kage/world.js";

// The flythrough is time-locked to real seconds, so any frame that takes a
// long time advances it by that much wall-clock. A 2s threshold (what this
// used to be) meant a single hitch under two seconds — a shader compile, a
// texture upload, the OS descheduling the tab — silently ate that much of a
// ~9.5s cinematic, which on a phone or tablet looks like the intro barely
// playing at all. gsap's defaults treat anything over 500ms as a stall and
// charge it 33ms instead, which is what we want: hitches cost a dropped
// frame, never a skipped beat.
gsap.ticker.lagSmoothing(500, 33);

const canvas = document.getElementById("scene");
const loading = document.getElementById("loading");
const introUI = document.getElementById("intro-ui");
const enterBtn = document.getElementById("enter-btn");
const skipBtn = document.getElementById("skip-btn");
const hero = document.getElementById("hero");
const flashEl = document.getElementById("flash");
const loadingBar = loading.querySelector(".loading-bar span");

let started = false;

const world = new World(canvas, {
  onLoadProgress: (p) => {
    // Hand the bar over from its indeterminate sweep to real progress.
    loadingBar.classList.add("is-determinate");
    gsap.to(loadingBar, { width: `${p * 100}%`, duration: 0.25, ease: "power1.out" });
    if (p >= 1) {
      gsap.to(loading, {
        opacity: 0,
        duration: 0.7,
        delay: 0.15,
        onComplete: () => (loading.style.display = "none"),
      });
    }
  },
});

function revealHero() {
  hero.classList.add("visible");
  skipBtn.style.opacity = "0";
  skipBtn.style.pointerEvents = "none";
}

// Deliberately does NOT auto-skip under prefers-reduced-motion. That setting
// is about motion the visitor did not ask for; pressing ENTER on an intro is
// an explicit request to watch it, and silently swapping it for a cut to the
// site makes the whole thing look broken (a lot of iPads run with Reduce
// Motion on). Anyone who wants out has the SKIP control.
function startTransition() {
  // `world.ready` matters as much as `started`: playTransition refuses to run
  // before the model is in, and the Enter key is live while the loading
  // overlay is still up. Without this check an early keypress would flip
  // `started` with nothing started, and every later press would be swallowed
  // by the guard below — the intro would never play at all.
  if (started || !world.ready) return;
  started = true;
  world.playTransition({
    onIntroFade: () => {
      introUI.style.opacity = "0";
      introUI.style.pointerEvents = "none";
    },
    onComplete: revealHero,
    flashEl,
  });
}

function skipIntro() {
  started = true;
  introUI.style.opacity = "0";
  introUI.style.pointerEvents = "none";
  world.skipTransition();
  revealHero();
}

enterBtn.addEventListener("click", startTransition);
canvas.addEventListener("click", () => {
  if (!started) startTransition();
});
skipBtn.addEventListener("click", skipIntro);
window.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startTransition();
});
