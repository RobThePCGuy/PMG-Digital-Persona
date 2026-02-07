/**
 * graph-view.js
 * Interactive spec dependency graph using Sigma.js + graphology.
 * No globals. No build step.
 */
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────── */
  var GROUP_COLORS = { home: '--accent', spec: '--accent2', meta: '--muted' };
  var GROUP_LABELS = { home: 'Home', spec: 'Spec', meta: 'Meta' };
  var SIZE_FLOOR = 4;
  var SIZE_CAP = 16;
  var FADE_NEAR = 0.20;
  var FADE_FAR = 0.10;
  var FADE_DELAY = 100;
  var TOOLTIP_DELAY = 200;
  var DRAG_THRESHOLD = 4;
  var EDGE_DEFAULT_SIZE = 0.5;
  var EDGE_HIGHLIGHT_SIZE = 1.5;
  var FORCE_ITERATIONS = 300;

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
    var raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return colorToHex(raw);
  }

  function colorToHex(color) {
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    var d = ctx.getImageData(0, 0, 1, 1).data;
    return '#' + ((1 << 24) + (d[0] << 16) + (d[1] << 8) + d[2]).toString(16).slice(1);
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
    var edgeSet = {};
    data.edges.forEach(function (e, i) {
      if (!ids[e.source]) errors.push('Edge ' + i + ': unknown source "' + e.source + '"');
      if (!ids[e.target]) errors.push('Edge ' + i + ': unknown target "' + e.target + '"');
      var edgeKey = e.source + '->' + e.target;
      if (edgeSet[edgeKey]) errors.push('Edge ' + i + ': duplicate edge ' + edgeKey);
      edgeSet[edgeKey] = true;
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
    listViewEl.innerHTML = '';
    Object.keys(GROUP_LABELS).forEach(function (key) {
      var list = groups[key];
      if (!list || !list.length) return;
      var div = document.createElement('div');
      div.className = 'graph-list-group';
      var h3 = document.createElement('h3');
      h3.textContent = GROUP_LABELS[key];
      div.appendChild(h3);
      var ul = document.createElement('ul');
      list.forEach(function (n) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = n.url;
        a.textContent = n.label;
        li.appendChild(a);
        if (n.description) {
          var span = document.createElement('span');
          span.className = 'list-desc';
          span.textContent = n.description;
          li.appendChild(span);
        }
        ul.appendChild(li);
      });
      div.appendChild(ul);
      listViewEl.appendChild(div);
    });
  }

  function layoutForceDirected(nodes, edges) {
    /* Simple force-directed layout — no extra library needed for small graphs */
    var i, j, n1, n2, dx, dy, dist, force, ex, ey;
    var repulsion = 20000;
    var attraction = 0.005;
    var damping = 0.85;
    var dt = 0.4;

    /* Initialize with circular positions + zero velocity */
    var step = (2 * Math.PI) / nodes.length;
    nodes.forEach(function (n, idx) {
      n._x = 300 * Math.cos(idx * step - Math.PI / 2);
      n._y = 300 * Math.sin(idx * step - Math.PI / 2);
      n._vx = 0;
      n._vy = 0;
    });

    var nodeMap = {};
    nodes.forEach(function (n) { nodeMap[n.id] = n; });

    for (i = 0; i < FORCE_ITERATIONS; i++) {
      /* Repulsion between all pairs */
      for (j = 0; j < nodes.length; j++) {
        for (var k = j + 1; k < nodes.length; k++) {
          n1 = nodes[j];
          n2 = nodes[k];
          dx = n1._x - n2._x;
          dy = n1._y - n2._y;
          dist = Math.sqrt(dx * dx + dy * dy) || 1;
          force = repulsion / (dist * dist);
          var fx = (dx / dist) * force;
          var fy = (dy / dist) * force;
          n1._vx += fx;
          n1._vy += fy;
          n2._vx -= fx;
          n2._vy -= fy;
        }
      }

      /* Attraction along edges */
      edges.forEach(function (e) {
        var src = nodeMap[e.source];
        var tgt = nodeMap[e.target];
        if (!src || !tgt) return;
        dx = tgt._x - src._x;
        dy = tgt._y - src._y;
        dist = Math.sqrt(dx * dx + dy * dy) || 1;
        force = attraction * dist;
        var fx = (dx / dist) * force;
        var fy = (dy / dist) * force;
        src._vx += fx;
        src._vy += fy;
        tgt._vx -= fx;
        tgt._vy -= fy;
      });

      /* Integrate + damp */
      nodes.forEach(function (n) {
        n._vx *= damping;
        n._vy *= damping;
        n._x += n._vx * dt;
        n._y += n._vy * dt;
      });
    }
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
    layoutForceDirected(data.nodes, data.edges);

    /* Resolve CSS colors once */
    var colors = {};
    Object.keys(GROUP_COLORS).forEach(function (k) {
      colors[k] = resolveColor(GROUP_COLORS[k]);
    });
    var nodeColor = resolveColor('--text');
    var nodeColorDim = resolveColor('--muted');
    var lineColor = resolveColor('--line');
    var edgeColor = lineColor + '40'; /* very low opacity edges */

    /* Add nodes — white/light filled circles (Obsidian style) */
    data.nodes.forEach(function (n) {
      var deg = degree[n.id] || 0;
      var size = SIZE_FLOOR + ((deg / maxDeg) * (SIZE_CAP - SIZE_FLOOR));
      graph.addNode(n.id, {
        label: n.label,
        x: n._x,
        y: n._y,
        size: size,
        color: nodeColorDim,
        url: n.url,
        description: n.description || '',
        group: n.group || 'meta'
      });
    });

    /* Add edges — thin, subtle lines */
    data.edges.forEach(function (e) {
      graph.addEdge(e.source, e.target, {
        size: EDGE_DEFAULT_SIZE,
        color: edgeColor
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
      labelDensity: 0.15,
      labelRenderedSizeThreshold: 4,
      labelColor: { color: textColor },
      labelFont: 'var(--sans)',
      labelSize: 13,
      defaultEdgeColor: edgeColor,
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
          res.color = lineColor + '30';
          res.label = '';
        } else if (hasSearch && searchMatches[node]) {
          res.color = accentColor;
        }

        /* Hover: hovered node glows accent, neighbors stay bright, rest fades */
        if (hoveredNode) {
          if (hoveredNode === node) {
            res.color = accentColor;
          } else {
            var isNeighbor = graph.hasEdge(hoveredNode, node) || graph.hasEdge(node, hoveredNode);
            if (isNeighbor) {
              res.color = nodeColor;
            } else {
              var opacity = deepFade ? FADE_FAR : FADE_NEAR;
              res.color = nodeColorDim + Math.round(opacity * 255).toString(16).padStart(2, '0');
              res.label = '';
            }
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

        /* Hover: connected edges glow accent, rest nearly vanish */
        if (hoveredNode) {
          if (src === hoveredNode || tgt === hoveredNode) {
            res.color = accentColor;
            res.size = EDGE_HIGHLIGHT_SIZE;
          } else {
            var opacity = deepFade ? FADE_FAR : FADE_NEAR;
            res.color = lineColor + Math.round(opacity * 255).toString(16).padStart(2, '0');
            res.size = EDGE_DEFAULT_SIZE;
          }
        }
        return res;
      }
    });

    /* Fit camera initially */
    var cam = renderer.getCamera();
    var ignoreCameraUpdate = true;
    cam.animatedReset({ duration: 0 });

    /* Track user camera interaction (defer to avoid catching initial reset) */
    requestAnimationFrame(function () { ignoreCameraUpdate = false; });
    cam.on('updated', function () {
      if (!ignoreCameraUpdate) userHasMoved = true;
    });

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
        ignoreCameraUpdate = true;
        if (reducedMotion) {
          cam.setState({ x: nodeX, y: nodeY, ratio: 0.5 });
        } else {
          cam.animate({ x: nodeX, y: nodeY, ratio: 0.5 }, { duration: 300 });
        }
        setTimeout(function () { ignoreCameraUpdate = false; }, 350);
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
      ignoreCameraUpdate = true;
      if (reducedMotion) {
        cam.animatedReset({ duration: 0 });
      } else {
        cam.animatedReset({ duration: 300 });
      }
      setTimeout(function () { ignoreCameraUpdate = false; }, 350);
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
  function loadAndInit(data) {
    var errors = validate(data);
    if (errors.length) {
      showError('Graph data error: ' + errors[0]);
      if (data.nodes) buildListView(data.nodes);
      return;
    }
    init(data);
  }

  function boot() {
    /* Try inline data first (works on file:// protocol) */
    var inlineEl = document.getElementById('graph-data');
    if (inlineEl) {
      try {
        var data = JSON.parse(inlineEl.textContent);
        loadAndInit(data);
        return;
      } catch (e) {
        showError('Invalid inline graph data: ' + e.message);
        return;
      }
    }

    /* Fall back to fetching graph.json */
    fetch('graph.json')
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to load graph.json (HTTP ' + res.status + ')');
        return res.json();
      })
      .then(loadAndInit)
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
