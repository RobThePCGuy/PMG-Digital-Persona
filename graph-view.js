/**
 * graph-view.js
 * Interactive spec dependency graph using Sigma.js + graphology.
 * No globals. No build step.
 */
(function () {
  'use strict';

  /* Constants */
  var GROUP_COLORS = { home: '--accent', spec: '--accent2', meta: '--muted' };
  var GROUP_LABELS = { home: 'Home', spec: 'Spec', meta: 'Meta' };

  var SIZE_FLOOR = 8;
  var SIZE_CAP = 28;

  /* Hover: quick dim, then deeper dim */
  var FADE_NEAR = 0.25;
  var FADE_FAR = 0.15;
  var FADE_DELAY = 100;

  var SEARCH_DIM = 0.22;

  var TOOLTIP_DELAY = 200;
  var DRAG_THRESHOLD = 4;

  var EDGE_DEFAULT_SIZE = 0.6;
  var EDGE_HIGHLIGHT_SIZE = 1.6;

  var FORCE_ITERATIONS = 300;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isTouch = 'ontouchstart' in window;

  /* DOM refs */
  var canvasEl = document.getElementById('sigma-canvas');
  var containerEl = document.getElementById('graph-container');
  var chipsEl = document.getElementById('graph-chips');
  var searchInput = document.getElementById('graph-search-input');
  var clearBtn = document.getElementById('graph-clear-btn');
  var resetBtn = document.getElementById('graph-reset-btn');
  var statusEl = document.getElementById('graph-status');
  var tooltipEl = document.getElementById('graph-tooltip');
  var listViewEl = document.getElementById('graph-list-view');
  var fallbackEl = document.getElementById('graph-fallback');

  if (!canvasEl || !containerEl) return;

  /* Resolve Sigma constructor (UMD bundle exports a namespace object) */
  var SigmaClass =
    (typeof Sigma !== 'undefined' && (Sigma.Sigma || Sigma['default'])) ||
    (typeof Sigma === 'function' ? Sigma : null);
  if (typeof SigmaClass !== 'function') {
    if (typeof console !== 'undefined') console.error('Sigma constructor not found.');
    return;
  }

  /* Helpers */
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function colorToHex(color) {
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    var d = ctx.getImageData(0, 0, 1, 1).data;
    return (
      '#' +
      ((1 << 24) + (d[0] << 16) + (d[1] << 8) + d[2])
        .toString(16)
        .slice(1)
    );
  }

  function resolveColor(varName) {
    var raw = cssVar(varName);
    return colorToHex(raw || '#000');
  }

  function withAlpha(hex, opacity) {
    var o = Math.max(0, Math.min(1, opacity));
    var a = Math.round(o * 255)
      .toString(16)
      .padStart(2, '0');
    if (!hex || hex[0] !== '#' || hex.length !== 7) return hex;
    return hex + a;
  }

  function showError(msg) {
    var el = document.createElement('div');
    el.className = 'graph-error';
    el.textContent = msg;
    containerEl.innerHTML = '';
    containerEl.appendChild(el);
    if (fallbackEl) fallbackEl.hidden = true;
  }

  function validate(data) {
    var errors = [];
    if (!data || !data.nodes || !Array.isArray(data.nodes)) errors.push('Missing or invalid nodes array.');
    if (!data || !data.edges || !Array.isArray(data.edges)) errors.push('Missing or invalid edges array.');
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
    if (!listViewEl) return;
    var groups = {};
    nodes.forEach(function (n) {
      var g = n.group || 'meta';
      if (!groups[g]) groups[g] = [];
      groups[g].push(n);
    });

    Object.keys(groups).forEach(function (g) {
      groups[g].sort(function (a, b) {
        return (a.label || '').localeCompare(b.label || '');
      });
    });

    listViewEl.innerHTML = '';
    Object.keys(GROUP_LABELS).forEach(function (g) {
      if (!groups[g] || !groups[g].length) return;

      var wrap = document.createElement('div');
      wrap.className = 'graph-list-group';

      var h = document.createElement('h3');
      h.textContent = GROUP_LABELS[g];
      wrap.appendChild(h);

      var ul = document.createElement('ul');
      groups[g].forEach(function (n) {
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

      wrap.appendChild(ul);
      listViewEl.appendChild(wrap);
    });
  }

  function layoutForceDirected(nodes, edges) {
    /* Small-graph force layout, deterministic enough for this scale */
    var repulsion = 20000;
    var attraction = 0.005;
    var damping = 0.85;
    var dt = 0.4;

    var step = (2 * Math.PI) / Math.max(1, nodes.length);
    nodes.forEach(function (n, idx) {
      n._x = 300 * Math.cos(idx * step - Math.PI / 2);
      n._y = 300 * Math.sin(idx * step - Math.PI / 2);
      n._vx = 0;
      n._vy = 0;
    });

    var nodeMap = {};
    nodes.forEach(function (n) { nodeMap[n.id] = n; });

    for (var i = 0; i < FORCE_ITERATIONS; i++) {
      for (var j = 0; j < nodes.length; j++) {
        for (var k = j + 1; k < nodes.length; k++) {
          var n1 = nodes[j];
          var n2 = nodes[k];
          var dx = n1._x - n2._x;
          var dy = n1._y - n2._y;
          var dist2 = dx * dx + dy * dy + 0.01;
          var f = repulsion / dist2;
          var fx = (dx / Math.sqrt(dist2)) * f;
          var fy = (dy / Math.sqrt(dist2)) * f;
          n1._vx += fx;
          n1._vy += fy;
          n2._vx -= fx;
          n2._vy -= fy;
        }
      }

      edges.forEach(function (e) {
        var a = nodeMap[e.source];
        var b = nodeMap[e.target];
        if (!a || !b) return;
        var dx = a._x - b._x;
        var dy = a._y - b._y;
        var dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        var f = -attraction * dist;
        var fx = (dx / dist) * f;
        var fy = (dy / dist) * f;
        a._vx += fx;
        a._vy += fy;
        b._vx -= fx;
        b._vy -= fy;
      });

      nodes.forEach(function (n) {
        n._vx *= damping;
        n._vy *= damping;
        n._x += n._vx * dt;
        n._y += n._vy * dt;
      });
    }
  }

  function init(data) {
    if (fallbackEl) fallbackEl.hidden = true;

    var graph = new graphology.Graph();

    /* Degree for sizing */
    var degree = {};
    data.nodes.forEach(function (n) { degree[n.id] = 0; });
    data.edges.forEach(function (e) {
      degree[e.source] = (degree[e.source] || 0) + 1;
      degree[e.target] = (degree[e.target] || 0) + 1;
    });
    var maxDeg = Math.max.apply(null, Object.values(degree).concat([1]));

    /* Layout */
    layoutForceDirected(data.nodes, data.edges);

    /* Resolve colors and fonts */
    var groupHex = {};
    Object.keys(GROUP_COLORS).forEach(function (k) {
      groupHex[k] = resolveColor(GROUP_COLORS[k]);
    });

    var accentColor = resolveColor('--accent');    var textColor = resolveColor('--text');
    var lineColor = resolveColor('--line');

    var fontSans = cssVar('--sans') || 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';

    /* Add nodes: group colors, degree-sized */
    data.nodes.forEach(function (n) {
      var g = n.group || 'meta';
      var baseColor = groupHex[g] || groupHex.meta || accentColor;

      var deg = degree[n.id] || 0;
      var size = SIZE_FLOOR + (deg / maxDeg) * (SIZE_CAP - SIZE_FLOOR);

      graph.addNode(n.id, {
        label: n.label,
        x: n._x,
        y: n._y,
        size: size,
        color: baseColor,
        labelColor: textColor,
        url: n.url,
        description: n.description || '',
        group: g
      });
    });

    /* Add edges: subtle lines */
    data.edges.forEach(function (e, idx) {
      graph.addEdge(e.source, e.target, {
        size: EDGE_DEFAULT_SIZE,
        color: withAlpha(lineColor, 0.25)
      });
    });

    buildListView(data.nodes);

    /* State */
    var hoveredNode = null;
    var fadeTimeout = null;
    var deepFade = false;
    var tooltipTimeout = null;
    var searchMatches = {};
    var hiddenGroups = {};
    var pointerDownPos = null;
    var userHasMoved = false;

    var renderer = new SigmaClass(graph, canvasEl, {
      renderLabels: true,
      labelDensity: 1,
      labelRenderedSizeThreshold: 0,
      labelColor: { attribute: 'labelColor', color: textColor },
      labelFont: fontSans,
      labelSize: 12,
      defaultEdgeColor: withAlpha(lineColor, 0.25),
      nodeReducer: function (node, attrs) {
        var res = Object.assign({}, attrs);
        var g = graph.getNodeAttribute(node, 'group');

        if (hiddenGroups[g]) {
          res.hidden = true;
          return res;
        }

        var hasSearch = Object.keys(searchMatches).length > 0;
        var isMatch = !!searchMatches[node];

        /* Hover takes priority */
        if (hoveredNode) {
          if (node === hoveredNode) {
            res.color = accentColor;
            res.labelColor = textColor;
            return res;
          }

          var isNeighbor =
            graph.hasEdge(hoveredNode, node) ||
            graph.hasEdge(node, hoveredNode);

          if (isNeighbor) {
            res.color = attrs.color;
            res.labelColor = textColor;
            return res;
          }

          var o = deepFade ? FADE_FAR : FADE_NEAR;
          res.color = withAlpha(attrs.color, o);
          res.labelColor = withAlpha(textColor, o);
          return res;
        }

        if (hasSearch && !isMatch) {
          res.color = withAlpha(attrs.color, SEARCH_DIM);
          res.labelColor = withAlpha(textColor, SEARCH_DIM);
          return res;
        }

        if (hasSearch && isMatch) {
          res.color = accentColor;
          res.labelColor = textColor;
          return res;
        }

        return res;
      },
      edgeReducer: function (edge, attrs) {
        var res = Object.assign({}, attrs);
        var src = graph.source(edge);
        var tgt = graph.target(edge);
        var sg = graph.getNodeAttribute(src, 'group');
        var tg = graph.getNodeAttribute(tgt, 'group');

        if (hiddenGroups[sg] || hiddenGroups[tg]) {
          res.hidden = true;
          return res;
        }

        if (hoveredNode) {
          if (src === hoveredNode || tgt === hoveredNode) {
            res.color = accentColor;
            res.size = EDGE_HIGHLIGHT_SIZE;
          } else {
            var o = deepFade ? FADE_FAR : FADE_NEAR;
            res.color = withAlpha(lineColor, o);
            res.size = EDGE_DEFAULT_SIZE;
          }
        }

        return res;
      }
    });

    var cam = renderer.getCamera();
    var ignoreCameraUpdate = true;

    function visibleNodes() {
      var nodes = [];
      graph.forEachNode(function (n) {
        var g = graph.getNodeAttribute(n, 'group');
        if (!hiddenGroups[g]) nodes.push(n);
      });
      return nodes;
    }

    function fitToVisible(animate) {
      var nodes = visibleNodes();
      if (!nodes.length) return;

      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(function (n) {
        var x = graph.getNodeAttribute(n, 'x');
        var y = graph.getNodeAttribute(n, 'y');
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      });

      var cx = (minX + maxX) / 2;
      var cy = (minY + maxY) / 2;

      ignoreCameraUpdate = true;
      cam.setState({ x: cx, y: cy, ratio: 1 });

      var rect = canvasEl.getBoundingClientRect();
      var w = rect.width || canvasEl.clientWidth || 800;
      var h = rect.height || canvasEl.clientHeight || 600;
      var padding = Math.min(w, h) * 0.10;
      var availW = Math.max(1, w - padding * 2);
      var availH = Math.max(1, h - padding * 2);

      var minVX = Infinity, minVY = Infinity, maxVX = -Infinity, maxVY = -Infinity;
      nodes.forEach(function (n) {
        var p = renderer.graphToViewport({
          x: graph.getNodeAttribute(n, 'x'),
          y: graph.getNodeAttribute(n, 'y')
        });
        if (p.x < minVX) minVX = p.x;
        if (p.y < minVY) minVY = p.y;
        if (p.x > maxVX) maxVX = p.x;
        if (p.y > maxVY) maxVY = p.y;
      });

      var spanW = Math.max(1, maxVX - minVX);
      var spanH = Math.max(1, maxVY - minVY);
      var factor = Math.max(spanW / availW, spanH / availH);
      if (!isFinite(factor) || factor <= 0) factor = 1;

      var ratio = Math.max(0.05, Math.min(10, factor * 1.10));

      if (reducedMotion || !animate) {
        cam.setState({ x: cx, y: cy, ratio: ratio });
        ignoreCameraUpdate = false;
        return;
      }

      cam.animate({ x: cx, y: cy, ratio: ratio }, { duration: 350 });
      setTimeout(function () { ignoreCameraUpdate = false; }, 380);
    }

    /* Initial fit with no animation */
    fitToVisible(false);
    requestAnimationFrame(function () { ignoreCameraUpdate = false; });

    cam.on('updated', function () {
      if (!ignoreCameraUpdate) userHasMoved = true;
    });

    /* Hover behavior */
    renderer.on('enterNode', function (event) {
      hoveredNode = event.node;
      deepFade = false;
      renderer.refresh();

      clearTimeout(fadeTimeout);
      if (reducedMotion) {
        deepFade = true;
        renderer.refresh();
      } else {
        fadeTimeout = setTimeout(function () {
          deepFade = true;
          renderer.refresh();
        }, FADE_DELAY);
      }

      if (isTouch) return;

      clearTimeout(tooltipTimeout);
      tooltipTimeout = setTimeout(function () {
        var desc = graph.getNodeAttribute(event.node, 'description');
        if (!desc) return;

        var p = renderer.graphToViewport({
          x: graph.getNodeAttribute(event.node, 'x'),
          y: graph.getNodeAttribute(event.node, 'y')
        });

        var cRect = containerEl.getBoundingClientRect();
        var left = p.x - cRect.left + 12;
        var top = p.y - cRect.top - 10;

        tooltipEl.textContent = desc;
        tooltipEl.style.left = left + 'px';
        tooltipEl.style.top = top + 'px';
        tooltipEl.classList.add('visible');

        /* Clamp into container after layout */
        requestAnimationFrame(function () {
          var maxLeft = containerEl.clientWidth - tooltipEl.offsetWidth - 8;
          var maxTop = containerEl.clientHeight - tooltipEl.offsetHeight - 8;
          var cl = Math.max(8, Math.min(maxLeft, left));
          var ct = Math.max(8, Math.min(maxTop, top));
          tooltipEl.style.left = cl + 'px';
          tooltipEl.style.top = ct + 'px';
        });
      }, TOOLTIP_DELAY);
    });

    renderer.on('leaveNode', function () {
      hoveredNode = null;
      deepFade = false;
      clearTimeout(fadeTimeout);
      clearTimeout(tooltipTimeout);
      tooltipEl.classList.remove('visible');
      renderer.refresh();
    });

    /* Click behavior (drag guard) */
    renderer.on('downNode', function (event) {
      pointerDownPos = { x: event.event.x, y: event.event.y };
    });

    renderer.on('clickNode', function (event) {
      if (pointerDownPos) {
        var dx = Math.abs(event.event.x - pointerDownPos.x);
        var dy = Math.abs(event.event.y - pointerDownPos.y);
        pointerDownPos = null;
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) return;
      }

      var url = graph.getNodeAttribute(event.node, 'url');
      if (url) window.location.href = url;
    });

    /* Search */
    function doSearch() {
      var q = (searchInput.value || '').toLowerCase().trim();
      searchMatches = {};

      if (!q) {
        statusEl.textContent = '';
        renderer.refresh();
        return;
      }

      var bestNode = null;
      var bestPos = Infinity;
      var bestLen = Infinity;

      graph.forEachNode(function (node) {
        var g = graph.getNodeAttribute(node, 'group');
        if (hiddenGroups[g]) return;

        var label = (graph.getNodeAttribute(node, 'label') || '').toLowerCase();
        var pos = label.indexOf(q);

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
      statusEl.textContent = count ? (count + ' match' + (count === 1 ? '' : 'es')) : 'No matches';
      renderer.refresh();

      if (bestNode) {
        var nodeX = graph.getNodeAttribute(bestNode, 'x');
        var nodeY = graph.getNodeAttribute(bestNode, 'y');

        ignoreCameraUpdate = true;
        if (reducedMotion) {
          cam.setState({ x: nodeX, y: nodeY, ratio: 0.55 });
          ignoreCameraUpdate = false;
        } else {
          cam.animate({ x: nodeX, y: nodeY, ratio: 0.55 }, { duration: 300 });
          setTimeout(function () { ignoreCameraUpdate = false; }, 330);
        }
      }
    }

    if (searchInput) searchInput.addEventListener('input', doSearch);

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        searchInput.value = '';
        searchMatches = {};
        statusEl.textContent = '';
        renderer.refresh();
        fitToVisible(true);
      });
    }

    /* Filter chips */
    function updateStatus() {
      var visibleGroups = 0;
      Object.keys(GROUP_LABELS).forEach(function (key) {
        if (!hiddenGroups[key]) visibleGroups++;
      });

      var visibleCount = 0;
      graph.forEachNode(function (node) {
        var g = graph.getNodeAttribute(node, 'group');
        if (!hiddenGroups[g]) visibleCount++;
      });

      statusEl.textContent = 'Showing ' + visibleCount + ' nodes in ' + visibleGroups + ' group' + (visibleGroups === 1 ? '' : 's') + '.';
    }

    function buildChips() {
      if (!chipsEl) return;
      chipsEl.innerHTML = '';

      var colors = {};
      Object.keys(GROUP_COLORS).forEach(function (k) {
        colors[k] = resolveColor(GROUP_COLORS[k]);
      });

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
          var isOn = btn.getAttribute('aria-pressed') === 'true';
          btn.setAttribute('aria-pressed', isOn ? 'false' : 'true');
          hiddenGroups[key] = isOn;

          if (hoveredNode) {
            var hg = graph.getNodeAttribute(hoveredNode, 'group');
            if (hiddenGroups[hg]) {
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

    buildChips();
    updateStatus();

    /* Reset button */
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        hiddenGroups = {};
        if (chipsEl) {
          chipsEl.querySelectorAll('.graph-chip').forEach(function (c) {
            c.setAttribute('aria-pressed', 'true');
          });
        }

        if (searchInput) searchInput.value = '';
        searchMatches = {};

        hoveredNode = null;
        deepFade = false;
        tooltipEl.classList.remove('visible');

        renderer.refresh();
        fitToVisible(true);
        updateStatus();
      });
    }

    /* Resize */
    var resizeTimeout;
    window.addEventListener(
      'resize',
      function () {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(function () {
          renderer.refresh();
          if (!userHasMoved) fitToVisible(false);
        }, 150);
      },
      { passive: true }
    );
  }

  function loadAndInit(data) {
    var errors = validate(data);
    if (errors.length) {
      showError('Graph data error: ' + errors[0]);
      if (data && data.nodes) buildListView(data.nodes);
      return;
    }
    init(data);
  }

  function boot() {
    /* graph.json is the source of truth */
    fetch('graph.json')
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to load graph.json (HTTP ' + res.status + ')');
        return res.json();
      })
      .then(loadAndInit)
      .catch(function (err) {
        /* Optional inline fallback for local previews */
        var inlineEl = document.getElementById('graph-data');
        if (inlineEl) {
          try {
            loadAndInit(JSON.parse(inlineEl.textContent));
            return;
          } catch (e) {
            showError('Invalid inline graph data: ' + e.message);
            return;
          }
        }
        showError('Could not load graph: ' + err.message);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
