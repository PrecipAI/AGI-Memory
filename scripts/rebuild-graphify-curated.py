from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from graphify.analyze import (
    _is_concept_node,
    _is_file_node,
    god_nodes,
    suggest_questions,
    surprising_connections,
)
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.export import to_html, to_json
from graphify.extract import extract
from graphify.report import generate

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "graphify-out"
INCLUDE_ROOTS = ("services", "libs", "scripts")
ALLOWED_SUFFIXES = {".ts", ".tsx", ".mjs"}
EXCLUDED_PARTS = {
    ".git",
    ".local",
    ".codex",
    "node_modules",
    "dist",
    "graphify-out",
}
EXCLUDED_SUFFIXES = (".d.ts", ".js", ".js.map", ".map")
EXCLUDED_SEGMENTS = {"generated"}
FRIENDLY_DOMAIN_NAMES = {
    "services/memory-service": "memory-service",
    "services/task-orchestrator": "task-orchestrator",
    "services/verification-service": "verification-service",
    "services/cleanup-coordinator": "cleanup-coordinator",
    "services/runtime-state-pruner": "runtime-state-pruner",
    "services/dlq-replay-controller": "dlq-replay-controller",
    "services/registry-service": "registry-service",
    "libs/db": "db-repositories",
    "libs/contracts": "contract-types",
    "libs/events": "event-contracts",
    "scripts": "tooling-scripts",
}
GENERIC_SYMBOLS = {
    "closePool",
    "createHttpError",
    "getDefaultScope",
    "getDefaultTenantId",
    "getHeader",
    "getPool",
    "getTraceId",
    "toJson",
}


def _normalize(path: Path) -> str:
    return path.as_posix()


def _domain_for(source_file: str) -> str:
    parts = source_file.replace("\\", "/").split("/")
    if not parts:
        return "unknown"
    if parts[0] == "services" and len(parts) > 1:
        return f"{parts[0]}/{parts[1]}"
    if parts[0] == "libs" and len(parts) > 1:
        return f"{parts[0]}/{parts[1]}"
    return parts[0]


def _friendly_domain(domain: str) -> str:
    return FRIENDLY_DOMAIN_NAMES.get(domain, domain.replace("/", "-"))


def _collect_code_files() -> tuple[list[Path], dict[str, int]]:
    files: list[Path] = []
    stats = Counter(
        included_files=0,
        skipped_directory_noise=0,
        skipped_generated_segments=0,
        skipped_compiled_artifacts=0,
        skipped_unsupported_suffix=0,
    )

    for top in INCLUDE_ROOTS:
        base = ROOT / top
        if not base.exists():
            continue

        for path in base.rglob("*"):
            if not path.is_file():
                continue

            rel_parts = path.relative_to(ROOT).parts
            lower_name = path.name.lower()

            if any(part in EXCLUDED_PARTS for part in rel_parts):
                stats["skipped_directory_noise"] += 1
                continue
            if any(part in EXCLUDED_SEGMENTS for part in rel_parts):
                stats["skipped_generated_segments"] += 1
                continue
            if lower_name.endswith(EXCLUDED_SUFFIXES):
                stats["skipped_compiled_artifacts"] += 1
                continue
            if path.suffix.lower() not in ALLOWED_SUFFIXES:
                stats["skipped_unsupported_suffix"] += 1
                continue

            files.append(path)
            stats["included_files"] += 1

    return sorted(files), dict(stats)


def _count_words(paths: list[Path]) -> int:
    total = 0
    for path in paths:
        try:
            total += len(path.read_text(encoding="utf-8", errors="ignore").split())
        except OSError:
            continue
    return total


def _relativize_payload_sources(payload: dict) -> None:
    for bucket in ("nodes", "edges", "hyperedges"):
        for item in payload.get(bucket, []):
            source_file = item.get("source_file")
            if not source_file:
                continue
            source_path = Path(source_file)
            if not source_path.is_absolute():
                continue
            try:
                item["source_file"] = _normalize(source_path.resolve().relative_to(ROOT))
            except ValueError:
                item["source_file"] = _normalize(source_path)


def _prune_visual_noise(graph) -> dict[str, int]:
    synthetic_nodes = [node_id for node_id in list(graph.nodes()) if _is_file_node(graph, node_id)]
    graph.remove_nodes_from(synthetic_nodes)

    isolated_nodes = [
        node_id
        for node_id in list(graph.nodes())
        if graph.degree(node_id) == 0 and not _is_concept_node(graph, node_id)
    ]
    graph.remove_nodes_from(isolated_nodes)

    return {
        "removed_synthetic_file_nodes": len(synthetic_nodes),
        "removed_isolated_nodes": len(isolated_nodes),
    }


def _community_labels(graph, communities: dict[int, list[str]]) -> dict[int, str]:
    labels: dict[int, str] = {}

    for community_id, node_ids in communities.items():
        domain_counts = Counter()
        symbol_scores: Counter[str] = Counter()

        for node_id in node_ids:
            node = graph.nodes[node_id]
            source_file = str(node.get("source_file") or "")
            if source_file:
                domain_counts[_domain_for(source_file)] += 1

            label = str(node.get("label") or node_id).strip()
            if not label or _is_file_node(graph, node_id) or _is_concept_node(graph, node_id):
                continue
            if label.endswith("()"):
                label = label[:-2]
            if label in GENERIC_SYMBOLS:
                continue
            symbol_scores[label] += max(graph.degree(node_id), 1)

        domains = [_friendly_domain(domain) for domain, _ in domain_counts.most_common(2)]
        domain_label = " + ".join(domains) if domains else f"community-{community_id}"

        symbols = [symbol for symbol, _ in symbol_scores.most_common(2)]
        labels[community_id] = (
            f"{domain_label} · {' / '.join(symbols)}" if symbols else domain_label
        )

    return labels


def _prepend_curation_notes(report: str, metadata: dict) -> str:
    notes = [
        "## Curation",
        f"- Source-only rebuild: {metadata['included_files']} curated files",
        (
            "- Excluded generated or compiled artifacts: "
            f"{metadata['skipped_generated_segments'] + metadata['skipped_compiled_artifacts']} files"
        ),
        f"- Removed synthetic file hubs from visualization: {metadata['removed_synthetic_file_nodes']} nodes",
        f"- Pruned isolated nodes from visualization: {metadata['removed_isolated_nodes']} nodes",
        "",
    ]
    return report.replace("## Corpus Check", "\n".join(notes) + "## Corpus Check", 1)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    code_files, stats = _collect_code_files()
    if not code_files:
        raise SystemExit("No curated source files found for graph rebuild.")

    extracted = extract(code_files, cache_root=ROOT)
    _relativize_payload_sources(extracted)

    graph = build_from_json(extracted)
    prune_stats = _prune_visual_noise(graph)

    communities = cluster(graph)
    cohesion = score_all(graph, communities)
    labels = _community_labels(graph, communities)
    gods = god_nodes(graph)
    surprises = surprising_connections(graph, communities)
    questions = suggest_questions(graph, communities, labels)

    detection = {
        "files": {"code": [_normalize(path.relative_to(ROOT)) for path in code_files]},
        "total_files": len(code_files),
        "total_words": _count_words(code_files),
        "warning": None,
    }
    token_cost = {"input": 0, "output": 0}
    report = generate(
        graph,
        communities,
        cohesion,
        labels,
        gods,
        surprises,
        detection,
        token_cost,
        ROOT.name,
        suggested_questions=questions,
    )

    metadata = {
        **stats,
        **prune_stats,
        "community_labels": labels,
        "node_count": graph.number_of_nodes(),
        "edge_count": graph.number_of_edges(),
        "community_count": len(communities),
    }

    report = _prepend_curation_notes(report, metadata)
    (OUT_DIR / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    (OUT_DIR / "graph-build-meta.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    to_json(graph, communities, str(OUT_DIR / "graph.json"))
    to_html(graph, communities, str(OUT_DIR / "graph.html"), community_labels=labels)

    print(
        json.dumps(
            {
                "included_files": len(code_files),
                "nodes": graph.number_of_nodes(),
                "edges": graph.number_of_edges(),
                "communities": len(communities),
                "removed_synthetic_file_nodes": prune_stats["removed_synthetic_file_nodes"],
                "removed_isolated_nodes": prune_stats["removed_isolated_nodes"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
