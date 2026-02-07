/**
 * graph-view.js
 * Interactive spec dependency graph using Sigma.js + graphology.
 * No globals. No build step. ~200 lines.
 */
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────── */
  var GROUP_COLORS = { home: '--accent', spec: '--accent2', meta: '--muted' };
  var GROUP_LABELS = { home: 'Home', spec: 'Spec', meta: 'Meta' };
  var SIZE_FLOOR = 8;
  var SIZE_CAP = 28;
  var FADE_NEAR = 0.25;
  var FADE_FAR = 0.15;
  var FADE_DELAY = 100;
  var TOOLTIP_DELAY = 200;
  var DRAG_THRESHOLD = 4;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isTouch = 'ontouchstart' in window;

  /* ── DOM refs ──────────────────────────────── */
  var canvasEl = document.getElementById('sigma-canvas');
  var containerEl = document.getElementById('graph-container');
  var chipsEl = document.getElementById('graph-chips');
  var searchInput = document.getElementById('graph-search-input');
  var clearBtn = document.getElementById('graph-clear-btn');
  var resetBtn = document.getElementById('graph-reset-btn');
  var statusEl = document.getElementById('graph-status');
  var tooltipEl = document.getElementById('graph-tooltip');
  var listViewEl = document.getElementById('graph-list-view');

  /* ── Helpers ───────────────────────────────── */
  function resolveColor(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }

  function showError(msg) {
    var el = document.createElement('div');
    el.className = 'graph-error';
    el.textContent = msg;
    containerEl.innerHTML = '';
    containerEl.appendChild(el);
  }

  /* ── Data loading & validation ─────────────── */
  function validate(data) {
    var errors = [];
    if (!data.nodes || !Array.isArray(data.nodes)) errors.push('Missing or invalid nodes array.');
    if (!data.edges || !Array.isArray(data.edges)) errors.push('Missing or invalid edges array.');
    if (errors.length) return errors;

    var ids = {};
    data.nodes.forEach(function (n, i) {
      if (!n.id) errors.push('Node at index ' + i + ' missing id.');
      if (ids[n.id]) errors.push('Duplicate node id: ' + n.id);
      ids[n.id] = true;
    });
    data.edges.forEach(function (e, i) {
      if (!ids[e.source]) errors.push('Edge ' + i + ': unknown source "' + e.source + '"');
      if (!ids[e.target]) errors.push('Edge ' + i + ': unknown target "' + e.target + '"');
    });
    return errors;
  }

  function buildListView(nodes) {
    var groups = {};
    nodes.forEach(function (n) {
      var g = n.group || 'other';
      if (!groups[g]) groups[g] = [];
      groups[g].push(n);
    });
    var html = '';
    Object.keys(GROUP_LABELS).forEach(function (key) {
      var list = groups[key];
      if (!list || !list.length) return;
      html += '<div class="graph-list-group"><h3>' + GROUP_LABELS[key] + '</h3><ul>';
      list.forEach(function (n) {
        html += '<li><a href="' + n.url + '">' + n.label + '</a>';
        if (n.description) html += '<span class="list-desc">' + n.description + '</span>';
        html += '</li>';
      });
      html += '</ul></div>';
    });
    listViewEl.innerHTML = html;
  }

  function layoutCircular(nodes) {
    var r = 100;
    var step = (2 * Math.PI) / nodes.length;
    nodes.forEach(function (n, i) {
      n._x = r * Math.cos(i * step - Math.PI / 2);
      n._y = r * Math.sin(i * step - Math.PI / 2);
    });
  }

  /* ── Main ──────────────────────────────────── */
  function init(data) {
    var graph = new graphology.Graph();

    /* Compute degree for sizing */
    var degree = {};
    data.nodes.forEach(function (n) { degree[n.id] = 0; });
    data.edges.forEach(function (e) {
      degree[e.source] = (degree[e.source] || 0) + 1;
      degree[e.target] = (degree[e.target] || 0) + 1;
    });
    var maxDeg = Math.max.apply(null, Object.values(degree).concat([1]));

    /* Layout */
    layoutCircular(data.nodes);

    /* Resolve CSS colors once */
    var colors = {};
    Object.keys(GROUP_COLORS).forEach(function (k) {
      colors[k] = resolveColor(GROUP_COLORS[k]);
    });

    /* Add nodes */
    data.nodes.forEach(function (n) {
      var deg = degree[n.id] || 0;
      var size = SIZE_FLOOR + ((deg / maxDeg) * (SIZE_CAP - SIZE_FLOOR));
      graph.addNode(n.id, {
        label: n.label,
        x: n._x,
        y: n._y,
        size: size,
        color: colors[n.group] || colors.meta,
        url: n.url,
        description: n.description || '',
        group: n.group || 'meta'
      });
    });

    /* Add edges */
    var lineColor = resolveColor('--line');
    data.edges.forEach(function (e) {
      graph.addEdge(e.source, e.target, {
        size: 1.5,
        color: lineColor
      });
    });

    /* Build list view */
    buildListView(data.nodes);

    /* ── Sigma renderer ──────────────────────── */
    var accentColor = resolveColor('--accent');
    var textColor = resolveColor('--text');

    /* State */
    var hoveredNode = null;
    var fadeTimeout = null;
    var deepFade = false;
    var searchMatches = {};
    var hiddenGroups = {};
    var userHasMoved = false;
    var pointerDownPos = null;
    var tooltipTimeout = null;

    var renderer = new Sigma(graph, canvasEl, {
      labelDensity: 0.12,
      labelRenderedSizeThreshold: 6,
      labelColor: { color: textColor },
      defaultEdgeColor: lineColor,
      renderLabels: true,
      nodeReducer: function (node, attrs) {
        var res = Object.assign({}, attrs);
        var nodeGroup = graph.getNodeAttribute(node, 'group');

        /* Group filter */
        if (hiddenGroups[nodeGroup]) {
          res.hidden = true;
          return res;
        }

        /* Search highlighting */
        var hasSearch = Object.keys(searchMatches).length > 0;
        if (hasSearch && !searchMatches[node]) {
          res.color = lineColor;
          res.label = '';
        }

        /* Hover fade */
        if (hoveredNode && hoveredNode !== node) {
          var isNeighbor = graph.hasEdge(hoveredNode, node) || graph.hasEdge(node, hoveredNode);
          if (!isNeighbor) {
            var opacity = deepFade ? FADE_FAR : FADE_NEAR;
            res.color = res.color + Math.round(opacity * 255).toString(16).padStart(2, '0');
            res.label = '';
          }
        }
        return res;
      },
      edgeReducer: function (edge, attrs) {
        var res = Object.assign({}, attrs);
        var src = graph.source(edge);
        var tgt = graph.target(edge);
        var srcGroup = graph.getNodeAttribute(src, 'group');
        var tgtGroup = graph.getNodeAttribute(tgt, 'group');

        /* Hide if either endpoint is hidden */
        if (hiddenGroups[srcGroup] || hiddenGroups[tgtGroup]) {
          res.hidden = true;
          return res;
        }

        /* Hover highlight */
        if (hoveredNode) {
          if (src === hoveredNode || tgt === hoveredNode) {
            res.color = accentColor;
            res.size = 2.5;
          } else {
            var opacity = deepFade ? FADE_FAR : FADE_NEAR;
            res.color = lineColor + Math.round(opacity * 255).toString(16).padStart(2, '0');
          }
        }
        return res;
      }
    });

    /* Fit camera initially */
    renderer.getCamera().animatedReset({ duration: 0 });

    /* Track user camera interaction */
    renderer.getCamera().on('updated', function () { userHasMoved = true; });

    /* ── Hover behavior ──────────────────────── */
    renderer.on('enterNode', function (event) {
      hoveredNode = event.node;
      deepFade = false;
      renderer.refresh();

      clearTimeout(fadeTimeout);
      if (!reducedMotion) {
        fadeTimeout = setTimeout(function () {
          deepFade = true;
          renderer.refresh();
        }, FADE_DELAY);
      } else {
        deepFade = true;
        renderer.refresh();
      }

      /* Tooltip */
      if (!isTouch) {
        clearTimeout(tooltipTimeout);
        tooltipTimeout = setTimeout(function () {
          var desc = graph.getNodeAttribute(event.node, 'description');
          if (!desc) return;
          var pos = renderer.graphToViewport({
            x: graph.getNodeAttribute(event.node, 'x'),
            y: graph.getNodeAttribute(event.node, 'y')
          });
          var rect = containerEl.getBoundingClientRect();
          tooltipEl.textContent = desc;
          tooltipEl.style.left = (pos.x + 12) + 'px';
          tooltipEl.style.top = (pos.y - rect.top + containerEl.scrollTop - 8) + 'px';
          tooltipEl.classList.add('visible');
        }, TOOLTIP_DELAY);
      }
    });

    renderer.on('leaveNode', function () {
      hoveredNode = null;
      deepFade = false;
      clearTimeout(fadeTimeout);
      clearTimeout(tooltipTimeout);
      tooltipEl.classList.remove('visible');
      renderer.refresh();
    });

    /* ── Click behavior (drag guard) ─────────── */
    renderer.on('downNode', function (event) {
      pointerDownPos = { x: event.event.x, y: event.event.y };
    });

    renderer.on('clickNode', function (event) {
      if (pointerDownPos) {
        var dx = Math.abs(event.event.x - pointerDownPos.x);
        var dy = Math.abs(event.event.y - pointerDownPos.y);
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
          pointerDownPos = null;
          return;
        }
      }
      pointerDownPos = null;
      var url = graph.getNodeAttribute(event.node, 'url');
      if (url) window.location.href = url;
    });

    /* ── Search ──────────────────────────────── */
    function doSearch() {
      var query = searchInput.value.toLowerCase().trim();
      searchMatches = {};

      if (!query) {
        renderer.refresh();
        statusEl.textContent = '';
        return;
      }

      var bestNode = null;
      var bestPos = Infinity;
      var bestLen = Infinity;

      graph.forEachNode(function (node) {
        var nodeGroup = graph.getNodeAttribute(node, 'group');
        if (hiddenGroups[nodeGroup]) return;
        var label = graph.getNodeAttribute(node, 'label').toLowerCase();
        var pos = label.indexOf(query);
        if (pos !== -1) {
          searchMatches[node] = true;
          if (pos < bestPos || (pos === bestPos && label.length < bestLen)) {
            bestPos = pos;
            bestLen = label.length;
            bestNode = node;
          }
        }
      });

      var count = Object.keys(searchMatches).length;
      if (count === 0) {
        statusEl.textContent = 'No matches';
      } else {
        statusEl.textContent = count + ' match' + (count === 1 ? '' : 'es');
      }

      renderer.refresh();

      if (bestNode) {
        var nodeX = graph.getNodeAttribute(bestNode, 'x');
        var nodeY = graph.getNodeAttribute(bestNode, 'y');
        var cam = renderer.getCamera();
        if (reducedMotion) {
          cam.setState({ x: nodeX, y: nodeY, ratio: 0.5 });
        } else {
          cam.animate({ x: nodeX, y: nodeY, ratio: 0.5 }, { duration: 300 });
        }
      }
    }

    searchInput.addEventListener('input', doSearch);

    clearBtn.addEventListener('click', function () {
      searchInput.value = '';
      searchMatches = {};
      statusEl.textContent = '';
      renderer.refresh();
      fitVisibleNodes();
    });

    /* ── Filter chips ────────────────────────── */
    function buildChips() {
      chipsEl.innerHTML = '';
      Object.keys(GROUP_LABELS).forEach(function (key) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'graph-chip';
        btn.setAttribute('aria-pressed', 'true');
        btn.setAttribute('aria-controls', 'sigma-canvas');
        btn.dataset.group = key;

        var dot = document.createElement('span');
        dot.className = 'chip-dot';
        dot.style.background = colors[key];
        btn.appendChild(dot);
        btn.appendChild(document.createTextNode(GROUP_LABELS[key]));
        chipsEl.appendChild(btn);

        btn.addEventListener('click', function () {
          var active = btn.getAttribute('aria-pressed') === 'true';
          btn.setAttribute('aria-pressed', active ? 'false' : 'true');
          hiddenGroups[key] = active;

          /* Clear hover if hovered node is now hidden */
          if (hoveredNode) {
            var hGroup = graph.getNodeAttribute(hoveredNode, 'group');
            if (hiddenGroups[hGroup]) {
              hoveredNode = null;
              deepFade = false;
              clearTimeout(fadeTimeout);
              tooltipEl.classList.remove('visible');
            }
          }

          renderer.refresh();
          updateStatus();
        });
      });
    }

    function updateStatus() {
      var visibleNodes = 0;
      var visibleGroups = 0;
      Object.keys(GROUP_LABELS).forEach(function (key) {
        if (!hiddenGroups[key]) visibleGroups++;
      });
      graph.forEachNode(function (node) {
        var g = graph.getNodeAttribute(node, 'group');
        if (!hiddenGroups[g]) visibleNodes++;
      });
      statusEl.textContent = 'Showing ' + visibleNodes + ' nodes in ' + visibleGroups + ' group' + (visibleGroups === 1 ? '' : 's') + '.';
    }

    buildChips();

    /* ── Reset button ────────────────────────── */
    function fitVisibleNodes() {
      userHasMoved = false;
      var cam = renderer.getCamera();
      if (reducedMotion) {
        cam.animatedReset({ duration: 0 });
      } else {
        cam.animatedReset({ duration: 300 });
      }
    }

    resetBtn.addEventListener('click', function () {
      /* Turn all groups on */
      hiddenGroups = {};
      var chips = chipsEl.querySelectorAll('.graph-chip');
      chips.forEach(function (c) { c.setAttribute('aria-pressed', 'true'); });

      /* Clear search */
      searchInput.value = '';
      searchMatches = {};

      /* Clear hover */
      hoveredNode = null;
      deepFade = false;
      tooltipEl.classList.remove('visible');

      renderer.refresh();
      fitVisibleNodes();
      updateStatus();
    });

    /* ── Resize handler ──────────────────────── */
    var resizeTimeout;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(function () {
        renderer.refresh();
        if (!userHasMoved) fitVisibleNodes();
      }, 150);
    }, { passive: true });
  }

  /* ── Boot ───────────────────────────────────── */
  function boot() {
    fetch('graph.json')
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to load graph.json (HTTP ' + res.status + ')');
        return res.json();
      })
      .then(function (data) {
        var errors = validate(data);
        if (errors.length) {
          showError('Graph data error: ' + errors[0]);
          if (data.nodes) buildListView(data.nodes);
          return;
        }
        init(data);
      })
      .catch(function (err) {
        showError('Could not load graph: ' + err.message);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
