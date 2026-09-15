import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initNav, initReveal, setYear } from "../../main.js";

const NAV_HTML = `
  <header class="nav">
    <div class="container nav__inner">
      <a href="#top" class="nav__logo">daniel<span class="accent">.moreno</span></a>
      <nav class="nav__links" id="navLinks">
        <a href="#about">About</a>
        <a href="#experience">Experience</a>
        <a href="#contact" class="btn btn--small">Contact</a>
      </nav>
      <button class="nav__toggle" id="navToggle" aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>
`;

function mountNav() {
  document.body.innerHTML = NAV_HTML;
}

describe("initNav", () => {
  let nav, toggle, links;

  beforeEach(() => {
    mountNav();
    ({ nav, toggle, links } = initNav());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("adds .scrolled when scrollY > 10", () => {
    Object.defineProperty(window, "scrollY", { value: 50, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    expect(nav.classList.contains("scrolled")).toBe(true);
  });

  it("removes .scrolled when back at top", () => {
    Object.defineProperty(window, "scrollY", { value: 50, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    expect(nav.classList.contains("scrolled")).toBe(false);
  });

  it("does not add .scrolled at exactly 10px (threshold is > 10)", () => {
    Object.defineProperty(window, "scrollY", { value: 10, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    expect(nav.classList.contains("scrolled")).toBe(false);
  });

  it("toggles .open on the links when the hamburger is clicked", () => {
    toggle.click();
    expect(links.classList.contains("open")).toBe(true);
    toggle.click();
    expect(links.classList.contains("open")).toBe(false);
  });

  it("closes the menu when a nav link is clicked", () => {
    toggle.click();
    links.querySelector("a").click();
    expect(links.classList.contains("open")).toBe(false);
  });
});

class MockIntersectionObserver {
  static instances = [];
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.observed = new Set();
    MockIntersectionObserver.instances.push(this);
  }
  observe(el) {
    this.observed.add(el);
  }
  unobserve(el) {
    this.observed.delete(el);
  }
  disconnect() {}
  trigger(entry) {
    this.callback([entry]);
  }
}

describe("initReveal", () => {
  let observer;

  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    document.body.innerHTML = `
      <div class="reveal" id="r0"></div>
      <div class="reveal" id="r1"></div>
      <div class="reveal" id="r2"></div>
      <div class="reveal" id="r3"></div>
      <div class="reveal" id="r4"></div>
      <div class="not-reveal"></div>
    `;
    ({ observer } = initReveal());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("observes every .reveal element with the 0.12 threshold", () => {
    expect(observer.observed.size).toBe(5);
    expect(observer.options).toEqual({ threshold: 0.12 });
  });

  it("assigns staggered transitionDelay of (i % 4) * 70ms", () => {
    const delays = [...document.querySelectorAll(".reveal")].map(
      (el) => el.style.transitionDelay
    );
    expect(delays).toEqual(["0ms", "70ms", "140ms", "210ms", "0ms"]);
  });

  it("adds .visible when the element intersects and stops observing it", () => {
    const el = document.getElementById("r0");
    observer.trigger({ isIntersecting: true, target: el });
    expect(el.classList.contains("visible")).toBe(true);
    expect(observer.observed.has(el)).toBe(false);
  });

  it("ignores non-intersecting entries", () => {
    const el = document.getElementById("r1");
    observer.trigger({ isIntersecting: false, target: el });
    expect(el.classList.contains("visible")).toBe(false);
    expect(observer.observed.has(el)).toBe(true);
  });
});

describe("setYear", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("writes the current year into #year", () => {
    document.body.innerHTML = `<footer><span id="year"></span></footer>`;
    setYear();
    expect(document.getElementById("year").textContent).toBe(
      String(new Date().getFullYear())
    );
  });

  it("is a no-op when #year is missing", () => {
    document.body.innerHTML = "<footer></footer>";
    expect(() => setYear()).not.toThrow();
  });
});
