/**
 * 3D Knowledge Terrain —— memory-service 知识图谱 3D 可视化模块
 *
 * 设计原则：每个视觉通道必须映射真实数据属性，拒绝纯炫。
 * - XY 平面：力导向聚类，同类/同主题节点自然扎堆
 * - Z 轴高度：utility_score × confidence_score，越高越可靠/有用
 * - 柱体颜色：节点类型（沿用现有 8 色分类）
 * - 发光/边框：utility_score 分级 + 治理层 L2/L3/L4
 * - 连线：relations + evidence_trace + proposals，颜色区分关系类型
 * - 粒子：孤立节点/待审查节点提示数据质量
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TYPE_COLORS = {
    entity: 0x06b6d4,
    fact: 0x10b981,
    knowledge: 0xf59e0b,
    evidence: 0x3b82f6,
    proposal: 0xf43f5e,
    rule: 0x8b5cf6,
    memory: 0xec4899,
    skill: 0x14b8a6
  };

  const LAYER_COLORS = {
    l2: 0xf43f5e,
    l3: 0xf59e0b,
    l4: 0x06b6d4,
    other: 0x64748b
  };

  const TYPE_NAMES = {
    entity: '实体',
    fact: '事实',
    knowledge: '合成知识',
    evidence: '证据',
    proposal: '治理提案',
    rule: '规则',
    memory: '记忆',
    skill: '技能'
  };

  const DEFAULT_CAMERA_DISTANCE = 220;
  const MAX_NODES_FULL_QUALITY = 400;
  const MAX_NODES_RENDER = 1200;

  class KnowledgeGraph3D {
    constructor(containerId, options = {}) {
      this.containerId = containerId;
      this.container = document.getElementById(containerId);
      if (!this.container) throw new Error(`KnowledgeGraph3D: container #${containerId} not found`);

      this.onNodeClick = options.onNodeClick || (() => {});
      this.onHover = options.onHover || (() => {});
      this.currentMode = options.mode || 'terrain';
      this.searchTerm = (options.searchTerm || '').toLowerCase();
      this.showTypes = options.showTypes || {
        entity: true, fact: true, knowledge: true, evidence: true,
        proposal: true, rule: true, memory: true, skill: true
      };

      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.controls = null;
      this.raycaster = null;
      this.pointer = new THREE.Vector2(-9999, -9999);
      this.graph = null;
      this.nodeObjects = new Map();
      this.linkObjects = [];
      this.starField = null;
      this.glowLayer = null;
      this.highlightPulse = 0;
      this.hoveredNode = null;
      this.selectedNode = null;
      this.animationId = null;
      this.isDisposed = false;
      this.lodMode = false;
      this.terrainGroup = new THREE.Group();

      this._init();
    }

    _init() {
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0b1120);
      this.scene.fog = new THREE.FogExp2(0x0b1120, 0.0025);

      this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
      this.camera.position.set(120, 120, DEFAULT_CAMERA_DISTANCE);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setClearColor(0x0b1120, 1);
      this.container.appendChild(this.renderer.domElement);

      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.minDistance = 20;
      this.controls.maxDistance = 800;
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 0.4;

      this.raycaster = new THREE.Raycaster();
      this.raycaster.params.Points.threshold = 6;

      this._addLights();
      this._addStarField();
      this._addTooltip();
      this.scene.add(this.terrainGroup);

      this._bindEvents();
      this._startAnimation();
    }

    _addTooltip() {
      this.tooltipEl = document.createElement('div');
      this.tooltipEl.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 10000;
        background: rgba(11, 17, 32, 0.92);
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 8px 10px;
        font-size: 12px;
        color: #f1f5f9;
        max-width: 260px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        opacity: 0;
        transition: opacity 0.1s ease;
        backdrop-filter: blur(4px);
      `;
      document.body.appendChild(this.tooltipEl);
    }

    _showTooltip(node, clientX, clientY) {
      if (!this.tooltipEl) return;
      const d = node.raw || {};
      const typeName = TYPE_NAMES[node.layer] || node.layer;
      const title = d.canonical_name || d.title || d.proposed_action || d.statement || d.content || node.name;
      const utility = typeof d.utility_score === 'number' ? d.utility_score.toFixed(2) : '无';
      const confidence = typeof d.confidence_score === 'number' ? d.confidence_score.toFixed(2) : '无';
      this.tooltipEl.innerHTML = `
        <div style="font-weight:600;color:#f59e0b;margin-bottom:4px;">[${typeName}] ${this._escapeHtml(String(title).slice(0, 40))}</div>
        <div style="color:#94a3b8;font-size:11px;">连接数: ${node.degree} · utility: ${utility} · 置信度: ${confidence}</div>
        <div style="color:#64748b;font-size:10px;margin-top:4px;">${node.id.slice(0, 12)}...</div>
      `;
      this.tooltipEl.style.left = `${clientX + 14}px`;
      this.tooltipEl.style.top = `${clientY + 14}px`;
      this.tooltipEl.style.opacity = '1';
    }

    _hideTooltip() {
      if (this.tooltipEl) this.tooltipEl.style.opacity = '0';
    }

    _escapeHtml(str) {
      return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    _addLights() {
      const ambient = new THREE.AmbientLight(0xffffff, 0.25);
      this.scene.add(ambient);

      const dir = new THREE.DirectionalLight(0xffffff, 0.6);
      dir.position.set(100, 200, 100);
      this.scene.add(dir);

      const fill = new THREE.DirectionalLight(0x64748b, 0.25);
      fill.position.set(-100, 50, -100);
      this.scene.add(fill);
    }

    _addStarField() {
      const count = 1500;
      const geom = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      const sizes = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 1200;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 1200;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 1200;
        sizes[i] = Math.random() * 1.5 + 0.3;
      }
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

      const mat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 1.2,
        transparent: true,
        opacity: 0.6,
        sizeAttenuation: true
      });
      this.starField = new THREE.Points(geom, mat);
      this.scene.add(this.starField);
    }

    _bindEvents() {
      const canvas = this.renderer.domElement;
      canvas.addEventListener('pointermove', this._onPointerMove.bind(this));
      canvas.addEventListener('pointerleave', () => { this.pointer.set(-9999, -9999); this.hoveredNode = null; this._hideTooltip(); });
      canvas.addEventListener('click', this._onClick.bind(this));
      canvas.addEventListener('dblclick', this._onDoubleClick.bind(this));
      window.addEventListener('resize', this._onResize.bind(this));
    }

    _onResize() {
      if (this.isDisposed) return;
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    }

    _onPointerMove(e) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.pointerClientX = e.clientX;
      this.pointerClientY = e.clientY;
    }

    _onClick(e) {
      if (this.hoveredNode) {
        this.selectedNode = this.hoveredNode;
        this.onNodeClick(this.hoveredNode.userData);
        this._focusNode(this.hoveredNode);
      }
    }

    _onDoubleClick(e) {
      this.controls.autoRotate = !this.controls.autoRotate;
    }

    _focusNode(mesh) {
      const target = new THREE.Vector3();
      mesh.getWorldPosition(target);
      const offset = this.camera.position.clone().sub(target).normalize().multiplyScalar(60);
      const endPos = target.clone().add(offset);

      const startPos = this.camera.position.clone();
      const startTarget = this.controls.target.clone();
      let t = 0;
      const animate = () => {
        if (this.isDisposed || t >= 1) return;
        t += 0.06;
        const eased = 1 - Math.pow(1 - t, 3);
        this.camera.position.lerpVectors(startPos, endPos, eased);
        this.controls.target.lerpVectors(startTarget, target, eased);
        requestAnimationFrame(animate);
      };
      animate();
    }

    _startAnimation() {
      const loop = () => {
        if (this.isDisposed) return;
        this.animationId = requestAnimationFrame(loop);
        this.controls.update();
        this._updateHover();
        this._updateHighlights();
        this.renderer.render(this.scene, this.camera);
      };
      loop();
    }

    _updateHover() {
      if (!this.nodeObjects.size) {
        this.hoveredNode = null;
        return;
      }
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const meshes = Array.from(this.nodeObjects.values()).map(n => n.mesh);
      const intersects = this.raycaster.intersectObjects(meshes, false);
      if (intersects.length > 0) {
        const mesh = intersects[0].object;
        if (this.hoveredNode !== mesh) {
          this.hoveredNode = mesh;
          this.onHover(mesh.userData);
          this._showTooltip(mesh.userData, this.pointerClientX, this.pointerClientY);
          document.body.style.cursor = 'pointer';
        }
      } else {
        if (this.hoveredNode) {
          this.hoveredNode = null;
          this.onHover(null);
          this._hideTooltip();
          document.body.style.cursor = 'default';
        }
      }
    }

    _updateHighlights() {
      this.highlightPulse += 0.04;
      const pulse = (Math.sin(this.highlightPulse) + 1) / 2;
      const searchActive = this.searchTerm.length > 0;

      this.nodeObjects.forEach(({ mesh, originalColor, originalEmissive }) => {
        const data = mesh.userData;
        const matched = searchActive && this._nodeMatchesSearch(data);
        const isSelected = this.selectedNode === mesh;
        const isHovered = this.hoveredNode === mesh;

        if (isSelected) {
          mesh.material.emissive.setHex(0xffffff);
          mesh.material.emissiveIntensity = 0.5;
        } else if (isHovered) {
          mesh.material.emissive.setHex(0xcccccc);
          mesh.material.emissiveIntensity = 0.35;
        } else if (matched) {
          const c = new THREE.Color(originalColor);
          mesh.material.emissive.setRGB(c.r, c.g, c.b);
          mesh.material.emissiveIntensity = 0.2 + pulse * 0.4;
        } else if (searchActive) {
          mesh.material.emissive.setHex(0x000000);
          mesh.material.emissiveIntensity = 0;
          mesh.material.opacity = 0.25;
        } else {
          mesh.material.emissive.setHex(originalEmissive || 0x000000);
          mesh.material.emissiveIntensity = isNaN(mesh.userData._origEmissiveIntensity) ? 0 : mesh.userData._origEmissiveIntensity;
          mesh.material.opacity = 1;
        }
      });

      this.linkObjects.forEach(link => {
        if (searchActive) {
          const sourceMatch = this._nodeMatchesSearch(link.userData.sourceData);
          const targetMatch = this._nodeMatchesSearch(link.userData.targetData);
          link.material.opacity = sourceMatch || targetMatch ? 0.8 : 0.08;
        } else {
          link.material.opacity = link.userData.baseOpacity;
        }
      });
    }

    _nodeMatchesSearch(data) {
      if (!this.searchTerm) return false;
      const haystack = `${data.name} ${data.raw.canonical_name || ''} ${data.raw.title || ''} ${data.raw.statement || ''} ${data.raw.content || ''} ${data.raw.proposed_action || ''} ${data.raw.description || ''} ${data.raw.content_excerpt || ''}`.toLowerCase();
      return haystack.includes(this.searchTerm);
    }

    _computeNodeHeight(raw) {
      const utility = typeof raw.utility_score === 'number' ? raw.utility_score : 0.5;
      const confidence = typeof raw.confidence_score === 'number' ? raw.confidence_score : 0.7;
      return Math.max(2, Math.min(40, (utility * 0.6 + confidence * 0.4) * 40));
    }

    _computeNodeSize(layer, degree) {
      const base = layer === 'knowledge' ? 5 : layer === 'proposal' ? 4 : 3;
      return Math.min(14, base + Math.min(degree, 10) * 0.7);
    }

    _createVoxelBar(x, y, z, width, height, depth, color, emissive = 0x000000, emissiveIntensity = 0) {
      const geometry = new THREE.BoxGeometry(width, height, depth);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity,
        roughness: 0.35,
        metalness: 0.2,
        transparent: true,
        opacity: 0.95
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y + height / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }

    _createCurveLink(p1, p2, color, opacity = 0.5, dashed = false) {
      const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
      mid.y += 8;
      const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
      const points = curve.getPoints(24);
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity
      });
      if (dashed) {
        material.dashSize = 3;
        material.gapSize = 2;
      }
      const line = new THREE.Line(geometry, material);
      line.userData.baseOpacity = opacity;
      return line;
    }

    render(data) {
      this.clear();
      const nodes = [];
      const nodeIndex = new Map();
      const degreeMap = new Map();

      const bumpDegree = (id) => {
        if (!id) return;
        degreeMap.set(id, (degreeMap.get(id) ?? 0) + 1);
      };

      (data.relations || []).forEach(r => {
        bumpDegree(String(r.from_object_id ?? ''));
        bumpDegree(String(r.to_object_id ?? ''));
      });
      (data.evidence_trace || []).forEach(et => {
        bumpDegree(String(et.synthesized_knowledge_id ?? ''));
        bumpDegree(String(et.evidence_id ?? ''));
      });
      (data.governance_proposals || []).forEach(p => {
        bumpDegree(String(p.target_object_id ?? ''));
        bumpDegree(String(p.id));
      });

      const pushNode = (id, name, layer, raw) => {
        if (!id || nodeIndex.has(id)) return;
        if (!this.showTypes[layer]) return;
        const degree = degreeMap.get(id) ?? 0;
        nodes.push({ id, name: name || id.slice(0, 8), layer, raw, degree });
        nodeIndex.set(id, nodes.length - 1);
      };

      (data.entities || []).forEach(e => pushNode(String(e.id), String(e.canonical_name || e.name || 'entity'), 'entity', e));
      (data.facts || []).forEach(f => pushNode(String(f.id), String(f.title || f.normalized_statement || 'fact').slice(0, 40), 'fact', f));
      (data.synthesized_knowledge || []).forEach(k => pushNode(String(k.id), String(k.title || 'synthesized').slice(0, 40), 'knowledge', k));
      (data.evidence || []).forEach(ev => pushNode(String(ev.id || ev.evidence_id || ''), String(ev.content_excerpt || ev.fact_statement || ev.content || ev.statement || 'evidence').slice(0, 40), 'evidence', ev));
      (data.governance_proposals || []).forEach(p => pushNode(String(p.id), String(p.proposed_action || 'proposal').slice(0, 40), 'proposal', p));
      (data.rules || []).forEach(r => pushNode(String(r.id), String(r.title || r.rule_key || 'rule').slice(0, 40), 'rule', r));
      (data.memories || []).forEach(m => pushNode(String(m.id), String(m.title || 'memory').slice(0, 40), 'memory', m));
      (data.skills || []).forEach(s => pushNode(String(s.id), String(s.title || s.skill_key || 'skill').slice(0, 40), 'skill', s));

      this.lodMode = nodes.length > MAX_NODES_FULL_QUALITY;
      const displayNodes = nodes.length > MAX_NODES_RENDER ? this._aggregateNodes(nodes) : nodes;

      const gData = {
        nodes: displayNodes.map(n => ({ id: n.id, ...n })),
        links: []
      };

      const linkSources = [
        (data.relations || []).map(r => ({ source: String(r.from_object_id ?? ''), target: String(r.to_object_id ?? ''), type: 'relation', relation_type: r.relation_type, color: 0x475569 })),
        (data.evidence_trace || []).map(et => ({ source: String(et.synthesized_knowledge_id ?? ''), target: String(et.evidence_id ?? ''), type: 'evidence', color: 0x3b82f6 })),
        (data.governance_proposals || []).map(p => ({ source: String(p.target_object_id ?? ''), target: String(p.id), type: 'proposal', color: 0xf43f5e }))
      ].flat().filter(l => nodeIndex.has(l.source) && nodeIndex.has(l.target));

      gData.links = linkSources.map(l => ({ source: l.source, target: l.target, ...l }));

      if (displayNodes.length === 0) {
        this._renderInfo(0, 0, true);
        return;
      }

      this._buildGraph(gData, displayNodes, nodeIndex);
      this._renderInfo(displayNodes.length, gData.links.length, this.lodMode);
    }

    _aggregateNodes(nodes) {
      const byType = {};
      nodes.forEach(n => {
        byType[n.layer] = byType[n.layer] || [];
        byType[n.layer].push(n);
      });
      const aggregated = [];
      Object.entries(byType).forEach(([layer, list]) => {
        if (list.length <= 50) {
          aggregated.push(...list);
          return;
        }
        const chunks = Math.ceil(list.length / 50);
        for (let i = 0; i < chunks; i++) {
          const chunk = list.slice(i * 50, (i + 1) * 50);
          const avgUtility = chunk.reduce((s, n) => s + (n.raw.utility_score ?? 0.5), 0) / chunk.length;
          const avgConfidence = chunk.reduce((s, n) => s + (n.raw.confidence_score ?? 0.7), 0) / chunk.length;
          aggregated.push({
            id: `__agg_${layer}_${i}`,
            name: `${TYPE_NAMES[layer]}聚合 #${i + 1} (${chunk.length})`,
            layer,
            raw: {
              title: `${TYPE_NAMES[layer]}聚合 #${i + 1}`,
              utility_score: avgUtility,
              confidence_score: avgConfidence,
              _aggregatedIds: chunk.map(n => n.id),
              _aggregatedCount: chunk.length
            },
            degree: chunk.reduce((s, n) => s + n.degree, 0),
            aggregated: true
          });
        }
      });
      return aggregated;
    }

    _buildGraph(gData, displayNodes, nodeIndex) {
      const nodePositions = new Map();

      if (this.currentMode === 'terrain') {
        this._layoutTerrain(gData, nodePositions);
      } else if (this.currentMode === 'star') {
        this._layoutStar(gData, nodePositions);
      } else if (this.currentMode === 'layer') {
        this._layoutLayer(gData, nodePositions);
      }

      displayNodes.forEach(n => {
        const pos = nodePositions.get(n.id);
        if (!pos) return;
        const height = this._computeNodeHeight(n.raw);
        const size = this._computeNodeSize(n.layer, n.degree);
        const color = TYPE_COLORS[n.layer];

        let emissive = 0x000000;
        let emissiveIntensity = 0;

        const utility = n.raw.utility_score ?? null;
        if (utility !== null && !n.aggregated) {
          if (utility >= 0.8) {
            emissive = 0x10b981;
            emissiveIntensity = 0.25;
          } else if (utility >= 0.5) {
            emissive = 0x3b82f6;
            emissiveIntensity = 0.12;
          } else {
            emissive = 0xf43f5e;
            emissiveIntensity = 0.18;
          }
        }

        if (this.lodMode) {
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(size, height, size),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
          );
          mesh.position.set(pos.x, pos.y + height / 2, pos.z);
          mesh.userData = { ...n, _origEmissiveIntensity: 0 };
          this.terrainGroup.add(mesh);
          this.nodeObjects.set(n.id, { mesh, originalColor: color, originalEmissive: 0x000000 });
          return;
        }

        const group = new THREE.Group();
        group.position.set(pos.x, pos.y, pos.z);

        const bar = this._createVoxelBar(0, 0, 0, size, height, size, color, emissive, emissiveIntensity);
        bar.userData = { ...n, _origEmissiveIntensity: emissiveIntensity };
        group.add(bar);

        if (!n.aggregated && (n.layer === 'knowledge' || n.degree >= 6)) {
          const glow = new THREE.Mesh(
            new THREE.BoxGeometry(size * 1.6, height * 1.05, size * 1.6),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12 })
          );
          glow.position.y = height / 2;
          group.add(glow);
        }

        this.terrainGroup.add(group);
        this.nodeObjects.set(n.id, { mesh: bar, originalColor: color, originalEmissive: emissive });
      });

      gData.links.forEach(l => {
        const sourcePos = nodePositions.get(l.source);
        const targetPos = nodePositions.get(l.target);
        if (!sourcePos || !targetPos) return;

        const sNode = gData.nodes.find(n => n.id === l.source);
        const tNode = gData.nodes.find(n => n.id === l.target);
        const sHeight = sNode ? this._computeNodeHeight(sNode.raw) : 2;
        const tHeight = tNode ? this._computeNodeHeight(tNode.raw) : 2;

        const p1 = new THREE.Vector3(sourcePos.x, sourcePos.y + sHeight, sourcePos.z);
        const p2 = new THREE.Vector3(targetPos.x, targetPos.y + tHeight, targetPos.z);

        const line = this._createCurveLink(p1, p2, l.color, this.lodMode ? 0.15 : 0.55, l.type === 'proposal');
        line.userData.sourceData = sNode || {};
        line.userData.targetData = tNode || {};
        this.terrainGroup.add(line);
        this.linkObjects.push(line);
      });

      if (!this.lodMode) {
        this._addGroundPlane();
      }
    }

    _layoutTerrain(gData, nodePositions) {
      const nodes = gData.nodes.map(n => ({ ...n, x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 10, vx: 0, vy: 0, vz: 0 }));
      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const links = gData.links.map(l => ({ source: nodeMap.get(l.source), target: nodeMap.get(l.target), distance: 50 })).filter(l => l.source && l.target);

      const n = nodes.length;
      const iterations = Math.max(120, Math.min(300, n * 3));
      const repulsion = -180;
      const springK = 0.008;
      const damping = 0.6;
      const centerStrength = 0.015;
      const collideRadius = 14;

      for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < n; i++) {
          let fx = 0, fy = 0, fz = 0;
          const a = nodes[i];
          for (let j = 0; j < n; j++) {
            if (i === j) continue;
            const b = nodes[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dz = a.z - b.z;
            const dist2 = dx * dx + dy * dy + dz * dz + 1;
            const force = repulsion / dist2;
            const dist = Math.sqrt(dist2);
            fx += (dx / dist) * force;
            fy += (dy / dist) * force;
            fz += (dz / dist) * force;
          }
          fx -= a.x * centerStrength;
          fy -= a.y * centerStrength;
          fz -= a.z * centerStrength;
          a.vx = (a.vx + fx) * damping;
          a.vy = (a.vy + fy) * damping;
          a.vz = (a.vz + fz) * damping;
        }

        for (const l of links) {
          const dx = l.target.x - l.source.x;
          const dy = l.target.y - l.source.y;
          const dz = l.target.z - l.source.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          const force = (dist - l.distance) * springK;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          const fz = (dz / dist) * force;
          l.source.vx += fx;
          l.source.vy += fy;
          l.source.vz += fz;
          l.target.vx -= fx;
          l.target.vy -= fy;
          l.target.vz -= fz;
        }

        for (const a of nodes) {
          for (const b of nodes) {
            if (a === b) continue;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dz = a.z - b.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
            if (dist < collideRadius) {
              const force = (collideRadius - dist) * 0.05;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              const fz = (dz / dist) * force;
              a.vx += fx;
              a.vy += fy;
              a.vz += fz;
            }
          }
        }

        for (const a of nodes) {
          a.x += a.vx;
          a.y += a.vy;
          a.z += a.vz;
        }
      }

      const scale = Math.max(1, Math.min(2, 60 / Math.sqrt(n + 1)));
      nodes.forEach(n => {
        nodePositions.set(n.id, { x: n.x * scale, y: n.y * scale * 0.35, z: n.z * scale });
      });
    }

    _layoutStar(gData, nodePositions) {
      const centerId = this._findHubNode(gData.nodes);
      const center = { x: 0, y: 0, z: 0 };
      nodePositions.set(centerId, center);

      const others = gData.nodes.filter(n => n.id !== centerId);
      const rings = 3;
      others.forEach((n, i) => {
        const ring = (i % rings) + 1;
        const angle = (i / others.length) * Math.PI * 2 * rings + ring;
        const radius = 40 + ring * 45;
        nodePositions.set(n.id, {
          x: Math.cos(angle) * radius,
          y: (Math.random() - 0.5) * 30,
          z: Math.sin(angle) * radius
        });
      });
    }

    _layoutLayer(gData, nodePositions) {
      const layerGroups = { l2: [], l3: [], l4: [], other: [] };
      gData.nodes.forEach(n => {
        const layer = n.raw.layer || 'other';
        if (layerGroups[layer]) layerGroups[layer].push(n);
        else layerGroups.other.push(n);
      });

      const layerOrder = ['l2', 'l3', 'l4', 'other'];
      layerOrder.forEach((layer, idx) => {
        const list = layerGroups[layer];
        const y = (idx - 1.5) * 60;
        list.forEach((n, i) => {
          const angle = (i / Math.max(list.length, 1)) * Math.PI * 2;
          const radius = 30 + (i % 4) * 25;
          nodePositions.set(n.id, {
            x: Math.cos(angle) * radius,
            y,
            z: Math.sin(angle) * radius
          });
        });
      });
    }

    _findHubNode(nodes) {
      const knowledge = nodes.find(n => n.layer === 'knowledge');
      if (knowledge) return knowledge.id;
      const maxDegree = nodes.reduce((max, n) => (n.degree > max.degree ? n : max), nodes[0]);
      return maxDegree ? maxDegree.id : nodes[0]?.id;
    }

    _fallbackRandomLayout(gData, nodePositions) {
      gData.nodes.forEach((n, i) => {
        const angle = Math.random() * Math.PI * 2;
        const radius = 30 + Math.random() * 120;
        nodePositions.set(n.id, {
          x: Math.cos(angle) * radius,
          y: (Math.random() - 0.5) * 40,
          z: Math.sin(angle) * radius
        });
      });
    }

    _addGroundPlane() {
      const geometry = new THREE.PlaneGeometry(600, 600, 40, 40);
      const positions = geometry.attributes.position.array;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i + 2] = Math.sin(positions[i] * 0.02) * Math.cos(positions[i + 1] * 0.02) * 2;
      }
      geometry.computeVertexNormals();
      const material = new THREE.MeshBasicMaterial({
        color: 0x1e293b,
        wireframe: true,
        transparent: true,
        opacity: 0.12
      });
      const plane = new THREE.Mesh(geometry, material);
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = -2;
      this.terrainGroup.add(plane);
    }

    _renderInfo(nodeCount, linkCount, aggregated) {
      const el = document.getElementById('graph-render-info');
      if (!el) return;
      let text = `${nodeCount} 节点 / ${linkCount} 边`;
      if (aggregated) text += '（已聚合）';
      if (this.searchTerm) text += ` · 搜索"${this.searchTerm}"`;
      el.textContent = text;
    }

    setMode(mode) {
      this.currentMode = mode;
    }

    setSearch(term) {
      this.searchTerm = term.toLowerCase();
    }

    setShowTypes(types) {
      this.showTypes = { ...this.showTypes, ...types };
    }

    clear() {
      this.nodeObjects.clear();
      this.linkObjects = [];
      this.hoveredNode = null;
      this.selectedNode = null;
      while (this.terrainGroup.children.length > 0) {
        const child = this.terrainGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
        this.terrainGroup.remove(child);
      }
    }

    dispose() {
      this.isDisposed = true;
      if (this.animationId) cancelAnimationFrame(this.animationId);
      this.clear();
      if (this.starField) {
        this.starField.geometry.dispose();
        this.starField.material.dispose();
        this.scene.remove(this.starField);
      }
      if (this.tooltipEl && this.tooltipEl.parentNode) {
        this.tooltipEl.parentNode.removeChild(this.tooltipEl);
      }
      this.controls.dispose();
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
  }

export { KnowledgeGraph3D };
if (typeof window !== 'undefined') window.KnowledgeGraph3D = KnowledgeGraph3D;
