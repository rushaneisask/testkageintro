import "./style.css";
import gsap from "gsap";
import { World } from "./kage/world.js";

// The flythrough timeline is time-locked to real seconds. Default lag-smoothing
// (500ms/33ms) perpetually throttles it on sustained slow frames — but fully
// disabling it lets one catastrophic stall (e.g. a first-time shader compile)
// vault the whole timeline to completion in a single tick. Widen the window
// instead: normal-ish frames (<2s) still pace by real elapsed time, only a
// genuine multi-second stall gets clamped.
gsap.ticker.lagSmoothing(2000, 300);

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

// A sustained first-person camera flight filling the screen is a common
// motion-sickness trigger, so honour the OS setting and cut straight to the
// site instead. The spinning emblem still gets its moment.
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function startTransition() {
  if (started) return;
  if (prefersReducedMotion.matches) {
    skipIntro();
    return;
  }
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
