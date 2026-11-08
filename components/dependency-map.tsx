"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BaseEdge, Controls, getViewportForBounds, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider,
  useReactFlow, useStore, useUpdateNodeInternals, type Edge, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import type { ParseResult } from "@/lib/parser/index.mts";
import type { FoldedModule } from "@/lib/graph/folding.mts";
import { buildView, focusGraph, localEdgePath, ROW_HEIGHT, rowViewport, viewBounds, type Selection, type ViewNode } from "@/lib/graph/view.mts";
import "@xyflow/react/dist/style.css";

type FolderNode = Node<{
  module: ViewNode;
  focusedFiles: ReadonlySet<string>;
  selectedFile: string | null;
  hovered: Selection;
  active: boolean;
  focused: boolean;
  toggle: (folder: string) => void;
  selectFile: (path: string) => void;
  onHover: (selection: Selection) => void;
}, "folder">;

function Ports({ name, top, opacity = 1 }: { name: string; top: number; opacity?: number }) {
  return (
    <>
      <Handle type="target" position={Position.Left} id={`in:${name}`} style={{ top, opacity }} isConnectable={false} />
      <Handle type="source" position={Position.Right} id={`out:${name}`} style={{ top, opacity }} isConnectable={false} />
      <Handle type="target" position={Position.Right} id={`local:in:${name}`} style={{ top, opacity }} isConnectable={false} />
    </>
  );
}

/** Keeps file rows scrollable and clamps import endpoints to their visible list boundaries. */
function FolderRows({ id, data }: { id: string; data: FolderNode["data"] }) {
  const { module, focusedFiles, selectedFile, focused, selectFile, hovered, onHover } = data;
  const [scrollTop, setScrollTop] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const viewport = rowViewport(module.rows.length, scrollTop);
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => { updateNodeInternals(id); }, [id, scrollTop, updateNodeInternals]);
  useEffect(() => {
    const index = module.rows.findIndex(row => row.file.path === selectedFile);
    const element = list.current;
    if (index < 0 || !element) return;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
  }, [selectedFile, module.rows]);

  return (
    <>
      <div
        ref={list}
        role="region" aria-label={`Files in ${module.folder || "repository root"}`} tabIndex={0}
        className="nodrag nopan nowheel overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-accent"
        style={{ height: viewport.height, scrollbarGutter: "stable" }}
        onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
      >
        {module.rows.map(({ file, label }) => (
          <div key={file.path} style={{ opacity: hovered?.kind === "file" && hovered.id === file.path || !focused || focusedFiles.has(file.path) ? 1 : 0.18 }}>
            <button
              type="button"
              className={`nodrag flex w-full cursor-pointer items-center gap-2 border-t border-line px-3 text-left font-mono text-[12px] focus-visible:outline-2 focus-visible:outline-accent ${selectedFile === file.path || hovered?.kind === "file" && hovered.id === file.path ? "bg-accent/10 text-accent hover:bg-accent/20" : "hover:bg-accent/10"}`}
              style={{ height: ROW_HEIGHT }}
              onClick={() => selectFile(file.path)}
              onMouseEnter={() => onHover({ kind: "file", id: file.path })}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover({ kind: "file", id: file.path })}
              onBlur={() => onHover(null)}
              aria-pressed={selectedFile === file.path}
              title={file.path}
            >
              <span className="file-kind" data-extension={file.path.slice(file.path.lastIndexOf("."))} aria-hidden />
              <span>{label}</span>
              <span className="ml-auto flex shrink-0 gap-2 text-[10px] tabular-nums">
                <span className="text-incoming" title="Distinct files importing this file">←{file.fanIn}</span>
                <span className="text-outgoing" title="Distinct files imported by this file">{file.fanOut}→</span>
              </span>
            </button>
          </div>
        ))}
      </div>
      {module.rows.map(({ file }, index) => (
        <Ports key={file.path} name={file.path} top={module.headerHeight + viewport.positions[index]}
          opacity={!focused || focusedFiles.has(file.path) ? 1 : 0.18} />
      ))}
      {module.rows.length * ROW_HEIGHT > viewport.height && (
        <div className="flex items-center gap-2 border-t border-line px-3 text-[11px] text-muted" style={{ height: ROW_HEIGHT }}
          title="Connections to files outside the visible rows meet the list's top or bottom edge.">
          <span>{viewport.first + 1}–{viewport.last} of {module.rows.length} files</span>
          <span className="ml-auto tabular-nums">↑ {viewport.first} · ↓ {module.rows.length - viewport.last}</span>
        </div>
      )}
    </>
  );
}

/** Renders a folded folder or its file rows while reporting selection and hover to the shared explorer. */
function FolderPanel({ id, data }: NodeProps<FolderNode>) {
  const { module, active, toggle, hovered, onHover } = data;
  const highlighted = hovered?.kind === "folder" ? hovered.id === module.folder : module.files.some(file => file.path === hovered?.id);
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => { updateNodeInternals(id); }, [id, module.expanded, module.width, module.height, updateNodeInternals]);
  return (
    <div className={`folder-panel h-full w-full rounded-sm border bg-raised ${active || highlighted ? "border-accent" : "border-line"}`}>
      <button
        type="button"
        className="nodrag flex w-full cursor-pointer flex-col justify-center gap-1 px-3 text-left hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent"
        style={{ height: module.headerHeight }}
        onClick={() => toggle(module.folder)}
        onMouseEnter={() => onHover({ kind: "folder", id: module.folder })}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover({ kind: "folder", id: module.folder })}
        onBlur={() => onHover(null)}
        aria-expanded={module.expanded}
        aria-label={`${module.expanded ? "Close" : "Open"} ${module.folder || "repository root"}, ${module.files.length} files`}
        title={module.folder || "Repository root"}
      >
        <span className="flex w-full items-center gap-2 font-mono font-medium">
          <span aria-hidden className="text-muted">{module.expanded ? "−" : "+"}</span>
          <span>{module.label}</span>
        </span>
        <span className="flex w-full items-center gap-2 text-[11px] tabular-nums text-muted">
          <span>{module.files.length} files</span>
          <span className="ml-auto text-incoming" title="Distinct external files importing this folder">←{module.fanIn}</span>
          <span className="text-outgoing" title="Distinct files imported outside this folder">{module.fanOut}→</span>
        </span>
      </button>
      {!module.expanded && <Ports name="folder" top={module.headerHeight / 2} />}
      {module.expanded && <FolderRows id={id} data={data} />}
    </div>
  );
}

const nodeTypes = { folder: FolderPanel };
function LocalImportEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style }: EdgeProps) {
  return <BaseEdge id={id} path={localEdgePath(sourceX, sourceY, targetX, targetY)} markerEnd={markerEnd} style={style} interactionWidth={0} />;
}
const edgeTypes = { local: LocalImportEdge };

interface MapProps {
  analysis: ParseResult;
  modules: readonly FoldedModule[];
  expanded: ReadonlySet<string>;
  selection: Selection;
  hovered: Selection;
  onHover: (selection: Selection) => void;
  onSelectFile: (path: string) => void;
  onToggle: (folder: string) => void;
  onDeselect: () => void;
}

/** Projects resolved imports onto folder panels and refits changed layouts without zooming in. */
function Canvas({ analysis, modules, expanded, selection, hovered, onHover, onSelectFile, onToggle, onDeselect }: MapProps) {
  const { setViewport, getZoom, viewportInitialized } = useReactFlow<FolderNode>();
  const canvasWidth = useStore(state => state.width);
  const canvasHeight = useStore(state => state.height);
  const view = useMemo(() => buildView(modules, analysis.edges, expanded), [modules, analysis, expanded]);
  const fittedView = useRef<typeof view | null>(null);
  const focus = useMemo(() => focusGraph(modules, analysis.edges, selection), [modules, analysis, selection]);

  useEffect(() => {
    if (!viewportInitialized || canvasWidth <= 0 || canvasHeight <= 0 || fittedView.current === view) return;
    // These are the new panel dimensions, independent of React Flow's previous
    // measurements. Fitting after render cannot accidentally use the closed box.
    const bounds = viewBounds(view.nodes);
    if (!bounds) return;
    const maxZoom = fittedView.current ? getZoom() : 1;
    fittedView.current = view;
    void setViewport(getViewportForBounds(bounds, canvasWidth, canvasHeight, 0.01, maxZoom, 0.08), { duration: 0 });
  }, [view, canvasWidth, canvasHeight, viewportInitialized, setViewport, getZoom]);

  const nodes: FolderNode[] = view.nodes.map(module => ({
    id: module.id, type: "folder", position: module.position,
    width: module.width, height: module.height,
    // React Flow disables pointer events when dragging and built-in selection
    // are off; the folder's own buttons still need to receive clicks.
    style: { width: module.width, height: module.height, pointerEvents: "all", opacity: focus.folders.has(module.folder) || (hovered?.kind === "folder" ? hovered.id === module.folder : module.files.some(file => file.path === hovered?.id)) ? 1 : 0.18 },
    data: { module, focusedFiles: focus.files, focused: focus.folders.has(module.folder),
      selectedFile: selection?.kind === "file" ? selection.id : null,
      active: selection?.kind === "folder" ? selection.id === module.folder : module.files.some(file => file.path === selection?.id),
      hovered, onHover, toggle: onToggle, selectFile: onSelectFile },
  }));
  const edges: Edge[] = view.edges.map(edge => {
    const incident = edge.imports.filter(item => focus.selected.has(item.from) || focus.selected.has(item.to));
    const color = !selection || incident.length === 0 ? "var(--fg-muted)" : incident.some(item => focus.selected.has(item.from)) ? "var(--outgoing)" : "var(--incoming)";
    return { ...edge, type: edge.source === edge.target ? "local" : "default", selectable: false, focusable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
      style: { stroke: color, strokeWidth: selection && incident.length > 0 ? 1.2 : 0.75,
        opacity: !selection ? 0.3 : incident.length > 0 ? 1 : 0.06 },
      ariaLabel: edge.imports.map(item => `${item.from} imports ${item.to}`).join("; "),
    };
  });

  return (
    <div className="dependency-map flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3 text-[11px] text-muted">
        <span className="font-mono text-fg">ts-morph / compiler</span>
        <span className="ml-auto tabular-nums">{analysis.files.length} files · {modules.length} folders</span>
      </div>
      <div className="min-h-0 flex-1">
        <ReactFlow<FolderNode>
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          nodesDraggable={false} nodesConnectable={false} nodesFocusable={false}
          elementsSelectable={false} edgesFocusable={false}
          onPaneClick={onDeselect}
          minZoom={0.01} maxZoom={2}
        >
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-1 text-[10px] text-muted">
        <span>Click folder to open · click file to trace imports</span>
        <span className="ml-auto tabular-nums">{analysis.coverage.filesSkipped} skipped · {analysis.coverage.importsUnresolved} unresolved · {analysis.coverage.importsOutside} outside</span>
      </div>
    </div>
  );
}

export function DependencyMap(props: MapProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
