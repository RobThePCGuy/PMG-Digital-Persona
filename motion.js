/**
 * motion.js
 * Scroll-triggered reveals and sequential panel staggering.
 * Under 80 lines. No dependencies. No build step.
 */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function applyReveal(entries, observer) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var el = entry.target;
      el.classList.add('revealed');
      observer.unobserve(el);
    });
  }

  function applyHighlight(entries, observer) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var el = entry.target;
      el.classList.add('highlighted');
      observer.unobserve(el);
      setTimeout(function () {
        el.classList.remove('highlighted');
      }, 1500);
    });
  }

  function init() {
    // Scroll-triggered reveals
    var revealElements = document.querySelectorAll('[data-reveal]');
    if (revealElements.length) {
      // Fallback for browsers without IntersectionObserver
      if (!('IntersectionObserver' in window)) {
        revealElements.forEach(function (el) { el.classList.add('revealed'); });
      } else {
        var revealObserver = new IntersectionObserver(applyReveal, {
          threshold: 0.15,
          rootMargin: '0px 0px -40px 0px'
        });

        // Stagger panels inside sequences
        var panelIndex = 0;
        revealElements.forEach(function (el) {
          if (el.closest('.panel-sequence')) {
            var siblings = el.closest('.panel-sequence').querySelectorAll('[data-reveal]');
            var idx = Array.prototype.indexOf.call(siblings, el);
            el.style.transitionDelay = (idx * 0.2) + 's';
          }
          revealObserver.observe(el);
        });
      }
    }

    // Highlight on scroll for diagrams
    var highlightElements = document.querySelectorAll('[data-highlight-on-scroll]');
    if (highlightElements.length && 'IntersectionObserver' in window) {
      var highlightObserver = new IntersectionObserver(applyHighlight, {
        threshold: 0.3
      });
      highlightElements.forEach(function (el) {
        highlightObserver.observe(el);
      });
    }
  }

  function initBackToTop() {
    var btn = document.querySelector('.back-to-top');
    if (!btn) return;

    btn.removeAttribute('hidden');

    window.addEventListener('scroll', function () {
      if (window.scrollY > 400) {
        btn.classList.add('visible');
      } else {
        btn.classList.remove('visible');
      }
    }, { passive: true });

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); initBackToTop(); });
  } else {
    init();
    initBackToTop();
  }
})();
