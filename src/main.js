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
const loadingBar = loading.querySelector(".loading-bar span");

const world = new World(canvas);

let started = false;

function revealHero() {
  hero.classList.add("visible");
  skipBtn.style.opacity = "0";
  skipBtn.style.pointerEvents = "none";
}

function startTransition() {
  if (started) return;
  started = true;
  world.playTransition({
    onIntroFade: () => {
      introUI.style.opacity = "0";
      introUI.style.pointerEvents = "none";
    },
    onComplete: revealHero,
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

// simulated boot sequence, then hand off to the intro UI
gsap.to(loadingBar, {
  width: "100%",
  duration: 1.1,
  ease: "power1.inOut",
  onComplete: () => {
    gsap.to(loading, {
      opacity: 0,
      duration: 0.7,
      onComplete: () => (loading.style.display = "none"),
    });
  },
});
