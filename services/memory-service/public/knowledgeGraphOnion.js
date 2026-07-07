/**
 * Knowledge Graph Onion —— AGI-Memory 知识图谱同心圆洋葱布局
 *
 * 设计理念：外部感知流入内化为核心能力，像一个认知旋涡。
 * - 外圈（感知层）：evidence / fact / entity — 数量最多、分布最散
 * - 中圈（知识层）：knowledge — 从感知层提炼的结论
 * - 内圈（记忆层）：memory — 稳定化的经验快照
 * - 核心圈（规则层）：rule — 治理约束
 * - 最内核（技能层）：skill — 可执行的操作，绝对中心
 *
 * 渲染：HTML5 Canvas 2D
 * 布局：D3.js v7 forceSimulation + 自定义径向力（d3 作为全局 script 加载）
 * 节点：4 层径向渐变模拟 glow（无需 WebGL post-processing）
 */

const TYPE_COLORS = {
  entity: "#2A6B8C", // 深青蓝 — 版 C 感知层
  fact: "#5B8C5A", // 苔绿 — 版 C 事实
  knowledge: "#C68B3C", // 赭石 — 版 C Knowledge 层身份色
  evidence: "#4A7A8C", // 暮青蓝 — 证据
  proposal: "#B5684D", // terra-dim — 治理提案
  rule: "#7C5B9E", // 暖紫 — 版 C Rule 层身份色
  memory: "#3A6B9C", // 暖青蓝 — 记忆(版 C 暖色系)
  skill: "#CC785C", // 赤陶橙 — 版 C 主 accent,Skill 核心
};

const TYPE_NAMES = {
  entity: "实体",
  fact: "事实",
  knowledge: "知识",
  evidence: "证据",
  proposal: "治理提案",
  rule: "规则",
  memory: "记忆",
  skill: "技能",
};

// 环半径定义（外圈 → 内核）
const RING_RADII = {
  evidence: 400,
  fact: 400,
  entity: 400,
  knowledge: 260,
  memory: 150,
  rule: 80,
  skill: 30,
};

const RING_LABELS = [
  { r: 400, label: "Perception · 感知层", color: "rgba(74, 122, 140, 0.22)" }, // 暮青蓝
  { r: 260, label: "Knowledge · 知识层", color: "rgba(198, 139, 60, 0.22)" }, // 赭石
  { r: 150, label: "Memory · 记忆层", color: "rgba(58, 107, 156, 0.22)" }, // 暖青蓝
  { r: 80, label: "Rule · 规则层", color: "rgba(124, 91, 158, 0.22)" }, // 暖紫
  { r: 30, label: "Skill · 技能核", color: "rgba(204, 120, 92, 0.30)" }, // 赤陶橙(核心,稍强)
];

const BASE_SIZES = {
  entity: [14, 22],
  fact: [8, 14],
  evidence: [7, 12],
  knowledge: [18, 28],
  memory: [11, 17],
  rule: [13, 20],
  skill: [11, 16],
  proposal: [10, 16],
};

const GOVERNANCE_RELATIONS = new Set([
  "supports",
  "contradicts",
  "supersedes",
  "complements",
  "refines",
  "constrains",
  "applies_to",
]);

const RELATION_COLORS = {
  // 版 C 暖色系关系色 — 全部基于 terra / 四层身份色 / 派生暖色
  supports: "#5B8C5A", // 苔绿 — 支持
  contradicts: "#B85450", // 暖红 — 矛盾
  supersedes: "#C68B3C", // 赭石 — 覆写
  complements: "#4A7A8C", // 暮青蓝 — 互补
  refines: "#7C5B9E", // 暖紫 — 细化
  constrains: "#B5684D", // terra-dim — 约束
  applies_to: "#CC785C", // 赤陶橙 — 适用(主 accent)
  // 补全常用关系色
  integrates_with: "#2A6B8C", // 深青蓝 — 集成
  triggers: "#B85450", // 暖红 — 触发
  describes: "#7A6F5F", // 暖灰 — 描述(中性)
  synthesized_from: "#C68B3C", // 赭石 — 合成自
  evidenced_by: "#4A7A8C", // 暮青蓝 — 证据
  proposed_for: "#B5684D", // terra-dim — 提议
  iterates_from: "#7C5B9E", // 暖紫 — 迭代自
  mentions: "#CC785C", // 赤陶橙 — 提到(memory→entity 高频关系,用主 accent 突出)
  source_of: "#C68B3C", // 赭石 — 来源(evidence→rule/skill/memory)
  derived_from: "#7C5B9E", // 暖紫 — 派生自(跨层派生)
};

const RELATION_LABELS = {
  integrates_with: "集成",
  triggers: "触发",
  describes: "描述",
  synthesized_from: "合成自",
  evidenced_by: "证据",
  proposed_for: "提议",
  iterates_from: "迭代自",
  supports: "支持",
  contradicts: "矛盾",
  supersedes: "覆写",
  complements: "互补",
  refines: "细化",
  constrains: "约束",
  applies_to: "适用",
  mentions: "提到",
  source_of: "来源",
  derived_from: "派生自",
};

const MAX_NODES_FULL_QUALITY = 400;
const MAX_NODES_AGGREGATE = 1200;

class KnowledgeGraphOnion {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    if (!this.container)
      throw new Error(
        `KnowledgeGraphOnion: container #${containerId} not found`,
      );

    this.onNodeClick = options.onNodeClick || (() => {});
    this.onHover = options.onHover || (() => {});
    this.searchTerm = (options.searchTerm || "").toLowerCase();
    this.showTypes = options.showTypes || {
      entity: true,
      fact: true,
      knowledge: true,
      evidence: true,
      proposal: true,
      rule: true,
      memory: true,
      skill: true,
    };

    this.canvas = null;
    this.ctx = null;
    this.simulation = null;
    this.nodes = [];
    this.links = [];
    this.starFieldCanvas = null;

    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this.minZoom = 0.1;
    this.maxZoom = 5;

    this.hoveredNode = null;
    this.selectedNode = null;
    this.draggedNode = null;
    this.isPanning = false;
    this.lastPointer = { x: 0, y: 0 };

    this.animationId = null;
    this.time = 0;
    this.isDisposed = false;
    this.lodMode = false;
    this.tooltipEl = null;

    this._init();
  }

  _init() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.canvas = document.createElement("canvas");
    this.canvas.width = width * (window.devicePixelRatio || 1);
    this.canvas.height = height * (window.devicePixelRatio || 1);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.style.cursor = "default";
    this.container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext("2d");
    this.ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    this.centerX = width / 2;
    this.centerY = height / 2;

    this._buildStarField(width, height);
    this._buildTooltip();
    this._bindEvents();
    this._startAnimation();
  }

  _buildStarField(width, height) {
    this.starFieldCanvas = document.createElement("canvas");
    this.starFieldCanvas.width = width;
    this.starFieldCanvas.height = height;
    const sctx = this.starFieldCanvas.getContext("2d");

    // 版 C 暖夜墨底 — 不是冷蓝深空,是带温度的暗夜(呼应奶油纸的暖色系)
    sctx.fillStyle = "#1A1814";
    sctx.fillRect(0, 0, width, height);

    // 微弱暖色径向晕染(像旧纸在暗光下的颗粒感)
    const warmGlow = sctx.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.7,
    );
    warmGlow.addColorStop(0, "rgba(204, 120, 92, 0.04)");
    warmGlow.addColorStop(0.5, "rgba(122, 111, 95, 0.02)");
    warmGlow.addColorStop(1, "rgba(26, 24, 20, 0)");
    sctx.fillStyle = warmGlow;
    sctx.fillRect(0, 0, width, height);

    const starCount = 600;
    for (let i = 0; i < starCount; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const r = Math.random();
      let size, alpha;
      if (r < 0.02) {
        size = 1.5 + Math.random() * 1.5;
        alpha = 0.7 + Math.random() * 0.3;
        // 微小 glow — 暖米白而非冷蓝白
        const grad = sctx.createRadialGradient(x, y, 0, x, y, size * 3);
        grad.addColorStop(0, `rgba(245, 240, 232, ${alpha})`);
        grad.addColorStop(1, "rgba(245, 240, 232, 0)");
        sctx.fillStyle = grad;
        sctx.beginPath();
        sctx.arc(x, y, size * 3, 0, Math.PI * 2);
        sctx.fill();
      } else if (r < 0.15) {
        size = 0.8 + Math.random() * 0.8;
        alpha = 0.3 + Math.random() * 0.4;
      } else {
        size = 0.2 + Math.random() * 0.6;
        alpha = 0.1 + Math.random() * 0.25;
      }
      // 暖色调星光:hue 30-60(米黄/暖灰)而非 200-260(冷蓝)
      const hue = 30 + Math.random() * 30;
      sctx.fillStyle = `hsla(${hue}, 30%, 88%, ${alpha})`;
      sctx.beginPath();
      sctx.arc(x, y, size, 0, Math.PI * 2);
      sctx.fill();
    }
  }

  _buildTooltip() {
    this.tooltipEl = document.createElement("div");
    // 版 C · 奶油底 tooltip — 跟外围 UI 配色一致,Canvas 内仍保留深色场景
    this.tooltipEl.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 10000;
      background: rgba(251, 248, 242, 0.96);
      border: 1px solid #D9CFBF;
      border-left: 3px solid #CC785C;
      border-radius: 4px;
      padding: 10px 12px;
      font-size: 12px;
      color: #1A1814;
      max-width: 260px;
      box-shadow: 0 4px 16px rgba(26, 24, 20, 0.15);
      opacity: 0;
      transition: opacity 0.1s ease;
      backdrop-filter: blur(4px);
      font-family: 'Inter', sans-serif;
    `;
    document.body.appendChild(this.tooltipEl);
  }

  _bindEvents() {
    const canvas = this.canvas;
    canvas.addEventListener("pointerdown", this._onPointerDown.bind(this));
    canvas.addEventListener("pointermove", this._onPointerMove.bind(this));
    canvas.addEventListener("pointerup", this._onPointerUp.bind(this));
    canvas.addEventListener("pointerleave", this._onPointerLeave.bind(this));
    canvas.addEventListener("wheel", this._onWheel.bind(this), {
      passive: false,
    });
    canvas.addEventListener("click", this._onClick.bind(this));
    window.addEventListener("resize", this._onResize.bind(this));
  }

  _onResize() {
    if (this.isDisposed) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.canvas.width = width * (window.devicePixelRatio || 1);
    this.canvas.height = height * (window.devicePixelRatio || 1);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx = this.canvas.getContext("2d");
    this.ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    this.centerX = width / 2;
    this.centerY = height / 2;
    this._buildStarField(width, height);
  }

  _getMousePos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      clientX: e.clientX,
      clientY: e.clientY,
    };
  }

  _screenToWorld(x, y) {
    return {
      x: (x - this.panX) / this.zoom,
      y: (y - this.panY) / this.zoom,
    };
  }

  _onPointerDown(e) {
    const pos = this._getMousePos(e);
    const world = this._screenToWorld(pos.x, pos.y);
    const hit = this._hitTest(world.x, world.y);
    if (hit) {
      this.draggedNode = hit;
      hit.fx = hit.x;
      hit.fy = hit.y;
      if (this.simulation) this.simulation.alphaTarget(0.3).restart();
    } else {
      this.isPanning = true;
      this.lastPointer = pos;
      this.canvas.style.cursor = "grabbing";
    }
  }

  _onPointerMove(e) {
    const pos = this._getMousePos(e);
    if (this.draggedNode) {
      const world = this._screenToWorld(pos.x, pos.y);
      this.draggedNode.fx = world.x;
      this.draggedNode.fy = world.y;
    } else if (this.isPanning) {
      this.panX += pos.x - this.lastPointer.x;
      this.panY += pos.y - this.lastPointer.y;
      this.lastPointer = pos;
    } else {
      const world = this._screenToWorld(pos.x, pos.y);
      const hit = this._hitTest(world.x, world.y);
      if (hit !== this.hoveredNode) {
        this.hoveredNode = hit;
        if (hit) {
          this._showTooltip(hit, pos.clientX, pos.clientY);
          this.canvas.style.cursor = "pointer";
        } else {
          this._hideTooltip();
          this.canvas.style.cursor = "default";
        }
        this.onHover(hit);
      } else if (hit) {
        this._showTooltip(hit, pos.clientX, pos.clientY);
      }
    }
  }

  _onPointerUp(e) {
    if (this.draggedNode) {
      this.draggedNode.fx = null;
      this.draggedNode.fy = null;
      this.draggedNode = null;
      if (this.simulation) this.simulation.alphaTarget(0);
    }
    this.isPanning = false;
    this.canvas.style.cursor = this.hoveredNode ? "pointer" : "default";
  }

  _onPointerLeave() {
    this.hoveredNode = null;
    this.isPanning = false;
    this.draggedNode = null;
    this._hideTooltip();
    this.canvas.style.cursor = "default";
  }

  _onWheel(e) {
    e.preventDefault();
    const pos = this._getMousePos(e);
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(
      this.minZoom,
      Math.min(this.maxZoom, this.zoom * delta),
    );
    const ratio = newZoom / this.zoom;
    this.panX = pos.x - (pos.x - this.panX) * ratio;
    this.panY = pos.y - (pos.y - this.panY) * ratio;
    this.zoom = newZoom;
  }

  _onClick(e) {
    if (this.isPanning || this.draggedNode) return;
    const pos = this._getMousePos(e);
    const world = this._screenToWorld(pos.x, pos.y);
    const hit = this._hitTest(world.x, world.y);
    if (hit) {
      this.selectedNode = hit;
      this.onNodeClick({
        id: hit.id,
        name: hit.name,
        type: hit.type,
        raw: hit.raw,
        degree: hit.degree,
      });
    } else {
      this.selectedNode = null;
    }
  }

  _hitTest(x, y) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (n._hidden) continue;
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy <= n.radius * n.radius) return n;
    }
    return null;
  }

  _showTooltip(node, clientX, clientY) {
    if (!this.tooltipEl) return;
    const d = node.raw || {};
    const typeName = TYPE_NAMES[node.type] || node.type;
    const title =
      d.canonical_name ||
      d.title ||
      d.proposed_action ||
      d.statement ||
      d.content ||
      node.name;
    const utility =
      typeof d.utility_score === "number" ? d.utility_score.toFixed(2) : "无";
    const confidence =
      typeof d.confidence_score === "number"
        ? d.confidence_score.toFixed(2)
        : "无";
    this.tooltipEl.innerHTML = `
      <div style="font-weight:600;color:${TYPE_COLORS[node.type]};margin-bottom:4px;font-family:'Fraunces',Georgia,serif;">[${typeName}] ${this._escapeHtml(String(title).slice(0, 40))}</div>
      <div style="color:#7A6F5F;font-size:11px;font-family:'JetBrains Mono',monospace;">连接数: ${node.degree} · utility: ${utility} · 置信度: ${confidence}</div>
      <div style="color:#A39885;font-size:10px;margin-top:4px;font-family:'JetBrains Mono',monospace;">${String(node.id).slice(0, 12)}...</div>
    `;
    this.tooltipEl.style.left = `${clientX + 14}px`;
    this.tooltipEl.style.top = `${clientY + 14}px`;
    this.tooltipEl.style.opacity = "1";
  }

  _hideTooltip() {
    if (this.tooltipEl) this.tooltipEl.style.opacity = "0";
  }

  _escapeHtml(str) {
    return str.replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m],
    );
  }

  _startAnimation() {
    const loop = () => {
      if (this.isDisposed) return;
      this.animationId = requestAnimationFrame(loop);
      this.time += 0.016;
      this._render();
    };
    loop();
  }

  render(data) {
    this.clear();
    const degreeMap = new Map();
    const bumpDegree = (id) => {
      if (!id) return;
      degreeMap.set(id, (degreeMap.get(id) ?? 0) + 1);
    };

    (data.relations || []).forEach((r) => {
      bumpDegree(String(r.from_object_id ?? ""));
      bumpDegree(String(r.to_object_id ?? ""));
    });
    (data.evidence_trace || []).forEach((et) => {
      bumpDegree(String(et.synthesized_knowledge_id ?? ""));
      bumpDegree(String(et.evidence_id ?? ""));
    });
    (data.governance_proposals || []).forEach((p) => {
      bumpDegree(String(p.target_object_id ?? ""));
      bumpDegree(String(p.id));
    });

    const nodeIndex = new Map();
    const pushNode = (id, name, type, raw) => {
      if (!id || nodeIndex.has(id)) return;
      if (!this.showTypes[type]) return;
      const degree = degreeMap.get(id) ?? 0;
      this.nodes.push({
        id,
        name: name || id.slice(0, 8),
        type,
        raw,
        degree,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: 10,
      });
      nodeIndex.set(id, this.nodes.length - 1);
    };

    (data.entities || []).forEach((e) =>
      pushNode(
        String(e.id),
        String(e.canonical_name || e.name || "entity"),
        "entity",
        e,
      ),
    );
    (data.facts || []).forEach((f) =>
      pushNode(
        String(f.id),
        String(f.title || f.normalized_statement || "fact").slice(0, 40),
        "fact",
        f,
      ),
    );
    (data.synthesized_knowledge || []).forEach((k) =>
      pushNode(
        String(k.id),
        String(k.title || "synthesized").slice(0, 40),
        "knowledge",
        k,
      ),
    );
    (data.evidence || []).forEach((ev) =>
      pushNode(
        String(ev.id || ev.evidence_id || ""),
        String(
          ev.content_excerpt ||
            ev.fact_statement ||
            ev.content ||
            ev.statement ||
            "evidence",
        ).slice(0, 40),
        "evidence",
        ev,
      ),
    );
    (data.governance_proposals || []).forEach((p) =>
      pushNode(
        String(p.id),
        String(p.proposed_action || "proposal").slice(0, 40),
        "proposal",
        p,
      ),
    );
    (data.rules || []).forEach((r) =>
      pushNode(
        String(r.id),
        String(r.title || r.rule_key || "rule").slice(0, 40),
        "rule",
        r,
      ),
    );
    (data.memories || []).forEach((m) =>
      pushNode(
        String(m.id),
        String(m.title || "memory").slice(0, 40),
        "memory",
        m,
      ),
    );
    (data.skills || []).forEach((s) =>
      pushNode(
        String(s.id),
        String(s.title || s.skill_key || "skill").slice(0, 40),
        "skill",
        s,
      ),
    );

    this.lodMode = this.nodes.length > MAX_NODES_FULL_QUALITY;
    if (this.nodes.length > MAX_NODES_AGGREGATE) {
      this._aggregateNodes();
    }

    this._computeNodeSizes();

    const linkSources = [
      ...(data.relations || []).map((r) => ({
        source: String(r.from_object_id ?? ""),
        target: String(r.to_object_id ?? ""),
        type: "relation",
        rel: r.relation_type,
      })),
      ...(data.evidence_trace || []).map((et) => ({
        source: String(et.synthesized_knowledge_id ?? ""),
        target: String(et.evidence_id ?? ""),
        type: "evidence",
        rel: "evidenced_by",
      })),
      ...(data.governance_proposals || []).map((p) => ({
        source: String(p.target_object_id ?? ""),
        target: String(p.id),
        type: "proposal",
        rel: "proposed_for",
      })),
    ].filter((l) => nodeIndex.has(l.source) && nodeIndex.has(l.target));
    this.links = linkSources;

    this._initNodePositions();
    this._startSimulation();

    // 多次 fitView 覆盖 simulation 稳定过程
    setTimeout(() => this.fitView(), 600);
    setTimeout(() => this.fitView(), 1500);
    setTimeout(() => this.fitView(), 3000);

    this._renderInfo();
  }

  _aggregateNodes() {
    // 简化实现：保留前 1200 个节点
    if (this.nodes.length <= MAX_NODES_AGGREGATE) return;
    this.nodes = this.nodes.slice(0, MAX_NODES_AGGREGATE);
  }

  _computeNodeSizes() {
    const byType = {};
    this.nodes.forEach((n) => {
      byType[n.type] = byType[n.type] || [];
      byType[n.type].push(n);
    });
    Object.entries(byType).forEach(([type, list]) => {
      const sorted = [...list].sort((a, b) => a.degree - b.degree);
      const range = BASE_SIZES[type] || [8, 14];
      sorted.forEach((n, i) => {
        const t = sorted.length > 1 ? i / (sorted.length - 1) : 0.5;
        n.radius = range[0] + (range[1] - range[0]) * t;
      });
    });
  }

  _initNodePositions() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.centerX = width / 2;
    this.centerY = height / 2;

    this.nodes.forEach((n) => {
      const targetR = RING_RADII[n.type] || 300;
      const angle = Math.random() * Math.PI * 2;
      const r = targetR + (Math.random() - 0.5) * 30;
      n.x = this.centerX + Math.cos(angle) * r;
      n.y = this.centerY + Math.sin(angle) * r;
    });
  }

  _startSimulation() {
    if (this.simulation) this.simulation.stop();

    this.simulation = d3
      .forceSimulation(this.nodes)
      .force(
        "link",
        d3
          .forceLink(this.links, (d) => d.id)
          .id((d) => d.id)
          .distance((d) => (this._isGovernanceEdge(d) ? 180 : 50))
          .strength((d) => (this._isGovernanceEdge(d) ? 0.08 : 0.04)),
      )
      .force("charge", d3.forceManyBody().strength(-8))
      .force(
        "collide",
        d3
          .forceCollide()
          .radius((d) => d.radius + 3)
          .strength(0.6),
      )
      .alphaDecay(0.03)
      .velocityDecay(0.6);

    this.simulation.on("tick", () => {
      const cx = this.centerX;
      const cy = this.centerY;
      this.nodes.forEach((n) => {
        const targetR = RING_RADII[n.type] || 300;
        const dx = n.x - cx;
        const dy = n.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // 强径向约束：把节点牢牢拉到所属环上
        const force = (dist - targetR) * 0.25;
        n.vx -= (dx / dist) * force;
        n.vy -= (dy / dist) * force;
      });
    });
  }

  _isGovernanceEdge(link) {
    const rel = link.rel || link.type;
    return GOVERNANCE_RELATIONS.has(rel) || link.type === "proposal";
  }

  _render() {
    const ctx = this.ctx;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    // 1. 清屏 → 暖夜墨背景(版 C)
    if (this.starFieldCanvas) {
      ctx.drawImage(this.starFieldCanvas, 0, 0, width, height);
    } else {
      ctx.fillStyle = "#1A1814";
      ctx.fillRect(0, 0, width, height);
    }

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // 4. 环引导线
    this._drawRings(ctx);

    // 5. 边
    this._drawLinks(ctx);

    // 6. 节点
    this._drawNodes(ctx);

    // 7. 选中/悬停效果
    this._drawSelectionEffect(ctx);

    // 8. 节点标签
    if (this.zoom >= 0.6) {
      this._drawLabels(ctx);
    }

    ctx.restore();
  }

  _drawRings(ctx) {
    const cx = this.centerX;
    const cy = this.centerY;
    // 洋葱剖面:环之间暖色填充区分层 — 版 C 配色
    const ringFills = [
      { r: 400, fill: "rgba(74, 122, 140, 0.05)" }, // 感知层外(暮青蓝)
      { r: 260, fill: "rgba(198, 139, 60, 0.06)" }, // 知识层(赭石)
      { r: 150, fill: "rgba(58, 107, 156, 0.07)" }, // 记忆层(暖青蓝)
      { r: 80, fill: "rgba(124, 91, 158, 0.08)" }, // 规则层(暖紫)
      { r: 30, fill: "rgba(204, 120, 92, 0.14)" }, // 技能核(赤陶橙,核心稍强)
    ];
    ringFills.forEach((ring) => {
      ctx.beginPath();
      ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
      ctx.fillStyle = ring.fill;
      ctx.fill();
    });
    // 环线 — 暖灰虚线(不再是冷白)
    RING_LABELS.forEach((ring) => {
      ctx.beginPath();
      ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(245, 240, 232, 0.18)";
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // 标签 — Fraunces 衬线,暖色
      ctx.font = "500 12px Fraunces, Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = ring.color
        .replace(/0\.22\)/, "0.65)")
        .replace(/0\.30\)/, "0.75)");
      ctx.fillText(ring.label, cx, cy - ring.r - 8);
    });
  }

  _drawLinks(ctx) {
    const searchActive = this.searchTerm.length > 0;
    const selectedId = this.selectedNode?.id;
    const connectedIds = selectedId ? this._getConnectedIds(selectedId) : null;

    // 收集需要画关系标签的边（选中节点的直连边）
    const labeledEdges = [];

    this.links.forEach((link) => {
      const source =
        typeof link.source === "object"
          ? link.source
          : this.nodes.find((n) => n.id === link.source);
      const target =
        typeof link.target === "object"
          ? link.target
          : this.nodes.find((n) => n.id === link.target);
      if (!source || !target || source._hidden || target._hidden) return;

      const isGov = this._isGovernanceEdge(link);
      const relColor =
        RELATION_COLORS[link.rel] || (isGov ? "#C68B3C" : "#7A6F5F");

      let alpha = isGov ? 0.35 : 0.28; // 版 C:non-gov 从 0.12 提到 0.28,暖墨底上才看得见
      let width = isGov ? 1.5 : 1.0; // 版 C:non-gov 从 0.6 提到 1.0,避免太细看不清
      let isHighlighted = false;

      if (searchActive) {
        const sMatch = this._nodeMatchesSearch(source);
        const tMatch = this._nodeMatchesSearch(target);
        alpha = sMatch || tMatch ? alpha : alpha * 0.1;
      } else if (connectedIds) {
        const involved =
          connectedIds.has(source.id) && connectedIds.has(target.id);
        if (involved) {
          // 选中节点的直连边：高亮加粗
          alpha = 0.95;
          width = Math.max(2.5, width * 3);
          isHighlighted = true;
        } else {
          // 无关边：大幅变暗
          alpha = alpha * 0.08;
        }
      }

      if (isGov && !this.lodMode) {
        // glow pass
        ctx.strokeStyle = relColor;
        ctx.globalAlpha = isHighlighted ? alpha * 0.5 : alpha * 0.25;
        ctx.lineWidth = width * 4;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }

      // solid pass
      ctx.strokeStyle = relColor;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();

      // 跨环流动粒子(evidence_trace 类型)— 版 C 暮青蓝
      if (link.type === "evidence" && !this.lodMode) {
        const t = (this.time * 0.5 + (source.x + source.y) * 0.001) % 1;
        const px = source.x + (target.x - source.x) * t;
        const py = source.y + (target.y - source.y) * t;
        ctx.globalAlpha = alpha * 1.5;
        ctx.fillStyle = "#4A7A8C";
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      // 记录高亮边用于标签绘制
      if (isHighlighted) {
        labeledEdges.push({
          source,
          target,
          relColor,
          rel: link.rel || link.type,
        });
      }
    });

    // 绘制选中节点直连边的关系标签
    if (labeledEdges.length) {
      const invZoom = 1 / Math.max(this.zoom, 0.1); // 抵消 world scale，标签保持固定屏幕大小
      labeledEdges.forEach(({ source, target, relColor, rel }) => {
        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        const label = RELATION_LABELS[rel] || rel || "";
        if (!label) return;
        ctx.save();
        ctx.translate(midX, midY);
        ctx.scale(invZoom, invZoom);
        ctx.font = "500 10px Inter, sans-serif";
        const w = ctx.measureText(label).width + 10;
        const h = 16;
        // 背景 — 暖墨底而非冷蓝
        ctx.fillStyle = "rgba(26, 24, 20, 0.92)";
        ctx.strokeStyle = relColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, 3);
        ctx.fill();
        ctx.stroke();
        // 文字
        ctx.fillStyle = relColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, 0, 0);
        ctx.restore();
      });
    }
  }

  _drawNodes(ctx) {
    const searchActive = this.searchTerm.length > 0;
    const selectedId = this.selectedNode?.id;
    const connectedIds = selectedId ? this._getConnectedIds(selectedId) : null;

    this.nodes.forEach((n) => {
      if (n._hidden) return;
      const color = TYPE_COLORS[n.type] || "#64748b";

      // 呼吸动画
      const breathe =
        1 + Math.sin(this.time * 1.5 + this._hashId(n.id) * 0.3) * 0.05;
      const r = n.radius * breathe;

      let opacity = 1;
      if (searchActive) {
        opacity = this._nodeMatchesSearch(n) ? 1 : 0.1;
      } else if (connectedIds && !connectedIds.has(n.id)) {
        opacity = 0.15;
      }

      ctx.globalAlpha = opacity;

      // L1 环境光晕
      if (!this.lodMode) {
        const grad1 = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3);
        grad1.addColorStop(0, this._withAlpha(color, 0.15));
        grad1.addColorStop(1, this._withAlpha(color, 0));
        ctx.fillStyle = grad1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // L2 中层辉光
      if (!this.lodMode) {
        const grad2 = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 1.5);
        grad2.addColorStop(0, "rgba(255,255,255,0.6)");
        grad2.addColorStop(0.5, this._withAlpha(color, 0.8));
        grad2.addColorStop(1, this._withAlpha(color, 0));
        ctx.fillStyle = grad2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // L3 实色核心
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * 0.6, 0, Math.PI * 2);
      ctx.fill();

      // L4 白热中心
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * 0.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
    });
  }

  _drawSelectionEffect(ctx) {
    if (!this.selectedNode) return;
    const n = this.selectedNode;
    const r = n.radius;

    // 外圈扩散环 — 暖米白(版 C)而非冷白
    const pulseR = r * 1.8 + Math.sin(this.time * 3) * 4;
    ctx.strokeStyle = "rgba(245, 240, 232, 0.65)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(n.x, n.y, pulseR, 0, Math.PI * 2);
    ctx.stroke();

    // 12 条放射光线 — 暖米白
    ctx.strokeStyle = "rgba(245, 240, 232, 0.35)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + this.time * 0.5;
      const x1 = n.x + Math.cos(angle) * r * 1.2;
      const y1 = n.y + Math.sin(angle) * r * 1.2;
      const x2 = n.x + Math.cos(angle) * r * 2.2;
      const y2 = n.y + Math.sin(angle) * r * 2.2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  _drawLabels(ctx) {
    const labelAlpha = Math.min(1, (this.zoom - 0.6) / 0.6);
    const showAll = this.zoom >= 1.2;
    const alwaysShow = new Set(["knowledge", "entity", "rule", "proposal"]);

    this.nodes.forEach((n) => {
      if (n._hidden) return;
      const shouldShow =
        alwaysShow.has(n.type) ||
        showAll ||
        n === this.hoveredNode ||
        n === this.selectedNode;
      if (!shouldShow) return;

      ctx.font = "500 10px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // 暖米白标签(版 C)而非冷蓝白
      ctx.fillStyle = `rgba(245, 240, 232, ${labelAlpha})`;
      ctx.shadowColor = "#1A1814";
      ctx.shadowBlur = 3;
      const label = String(n.name).slice(0, 20);
      ctx.fillText(label, n.x, n.y + n.radius + 4);
      ctx.shadowBlur = 0;
    });
  }

  _withAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  _hashId(id) {
    let h = 0;
    const s = String(id);
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h) / 2147483647;
  }

  _nodeMatchesSearch(node) {
    if (!this.searchTerm) return false;
    const d = node.raw || {};
    const haystack =
      `${node.name} ${d.canonical_name || ""} ${d.title || ""} ${d.statement || ""} ${d.content || ""} ${d.proposed_action || ""} ${d.description || ""} ${d.content_excerpt || ""}`.toLowerCase();
    return haystack.includes(this.searchTerm);
  }

  _getConnectedIds(nodeId) {
    if (!this._connectedCache || this._connectedCache.id !== nodeId) {
      const ids = new Set([nodeId]);
      this.links.forEach((link) => {
        const s =
          typeof link.source === "object" ? link.source.id : link.source;
        const t =
          typeof link.target === "object" ? link.target.id : link.target;
        if (s === nodeId) ids.add(t);
        if (t === nodeId) ids.add(s);
      });
      this._connectedCache = { id: nodeId, ids };
    }
    return this._connectedCache.ids;
  }

  _renderInfo() {
    const el = document.getElementById("graph-render-info");
    if (!el) return;
    let text = `${this.nodes.length} 节点 / ${this.links.length} 边`;
    if (this.lodMode) text += "（已聚合）";
    if (this.searchTerm) text += ` · 搜索"${this.searchTerm}"`;
    el.textContent = text;
  }

  fitView() {
    if (!this.nodes.length) return;
    // 洋葱图不缩放适配 bounding box——那会破坏同心圆结构
    // 改成固定 zoom 居中，让 5 个环都清晰可见
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    // 外圈半径 400 + 节点半径 + 边距，需要的视口尺寸
    const requiredSize = (400 + 30) * 2;
    // 选一个让外圈刚好填满画布较短边的 zoom
    const shortSide = Math.min(width, height);
    this.zoom = Math.max(
      this.minZoom,
      Math.min(this.maxZoom, (shortSide / requiredSize) * 0.9),
    );
    this.panX = width / 2 - this.centerX * this.zoom;
    this.panY = height / 2 - this.centerY * this.zoom;
  }

  setMode(_mode) {
    // 同心圆无多模式，保留接口兼容
  }

  setSearch(term) {
    this.searchTerm = (term || "").toLowerCase();
    this._renderInfo();
  }

  setShowTypes(types) {
    this.showTypes = { ...this.showTypes, ...types };
  }

  // 从外部选中节点（节点列表点击时调用）
  selectNodeById(id) {
    const sid = String(id);
    const node = this.nodes.find((n) => n.id === sid);
    if (node) {
      this.selectedNode = node;
      this.onNodeClick({
        id: node.id,
        name: node.name,
        type: node.type,
        raw: node.raw,
        degree: node.degree,
      });
    } else {
      this.selectedNode = null;
    }
  }

  // 清除选中
  clearSelection() {
    this.selectedNode = null;
  }

  clear() {
    this.nodes = [];
    this.links = [];
    this.hoveredNode = null;
    this.selectedNode = null;
    this._connectedCache = null;
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }
  }

  dispose() {
    this.isDisposed = true;
    if (this.animationId) cancelAnimationFrame(this.animationId);
    if (this.simulation) this.simulation.stop();
    if (this.tooltipEl && this.tooltipEl.parentNode) {
      this.tooltipEl.parentNode.removeChild(this.tooltipEl);
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}

export { KnowledgeGraphOnion };
if (typeof window !== "undefined")
  window.KnowledgeGraphOnion = KnowledgeGraphOnion;
