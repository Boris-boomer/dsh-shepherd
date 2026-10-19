window.__ModuleLoader__.load({
	id: "dsh-agent-guard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom_client = require("react-dom/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client.tsx
		/**
		* dsh-sentinel · Client 浮窗。
		*/
		const REGISTRY_ID = "sentinel";
		const NS = "sentinel";
		const MODES = [
			"planning",
			"coding",
			"verify"
		];
		const MODE_ICONS = {
			planning: "📋",
			coding: "⌨️",
			verify: "🚀"
		};
		function getAt(value, path) {
			if (!value) return void 0;
			let cur = value;
			for (const key of path.split(".")) {
				if (cur == null || typeof cur !== "object") return void 0;
				cur = cur[key];
			}
			return cur;
		}
		function setAt(value, path, next) {
			const keys = path.split(".");
			const root = { ...value };
			let cur = root;
			for (let i = 0; i < keys.length - 1; i++) {
				const k = keys[i];
				const existing = cur[k];
				cur[k] = existing != null && typeof existing === "object" ? { ...existing } : {};
				cur = cur[k];
			}
			cur[keys[keys.length - 1]] = next;
			return root;
		}
		async function readSnapshot(ctx) {
			try {
				const response = await ctx.remote.settings.describe();
				if (!response.ok) return {};
				return (response.value.namespaces?.find((c) => c.ns === NS))?.value ?? {};
			} catch {
				return {};
			}
		}
		async function writeField(ctx, path, next, base) {
			try {
				const response = await ctx.remote.settings.describe();
				const revision = response.ok ? response.value.namespaces?.find((c) => c.ns === NS)?.revision : void 0;
				await ctx.remote.settings.update(NS, setAt(base ?? {}, path, next), revision);
			} catch (cause) {
				console.warn("[sentinel] settings update failed", cause instanceof Error ? cause.message : cause);
			}
		}
		async function callBackend(ctx, method, ...args) {
			const wrapped = await ctx.connection.rpc.call("/api", `sentinel/${method}`, { args: args.length === 0 ? {} : args.length === 1 ? args[0] : args });
			if (!wrapped || wrapped.ok !== true) throw new Error(wrapped?.error?.message ?? "RPC 调用失败");
			return wrapped.value;
		}
		function createFloatingContainer() {
			const container = document.createElement("div");
			container.style.cssText = `
    position: fixed; bottom: 180px; right: 24px; width: 320px; max-height: 400px;
    background: #ffffff; border: 1px solid #e0e0e0; border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.22); z-index: 999999;
    overflow: hidden; display: none; flex-direction: column;
    font-family: system-ui, -apple-system, sans-serif;
  `;
			let isDragging = false, offsetX = 0, offsetY = 0;
			container.addEventListener("mousedown", (e) => {
				if (!e.target.closest(".panel-header")) return;
				isDragging = true;
				const rect = container.getBoundingClientRect();
				offsetX = e.clientX - rect.left;
				offsetY = e.clientY - rect.top;
				container.style.cursor = "grabbing";
				e.preventDefault();
			});
			const onMove = (e) => {
				if (!isDragging) return;
				container.style.left = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - container.offsetWidth)) + "px";
				container.style.top = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - container.offsetHeight)) + "px";
				container.style.right = "auto";
				container.style.bottom = "auto";
			};
			const onUp = () => {
				if (isDragging) {
					isDragging = false;
					container.style.cursor = "default";
				}
			};
			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
			const orig = container.remove.bind(container);
			container.remove = () => {
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
				orig();
			};
			return container;
		}
		const LOOP_TOGGLES = [
			{
				label: "总开关",
				path: "loop.enabled"
			},
			{
				label: "文本重复 A",
				path: "loop.textRepeat.enabled"
			},
			{
				label: "工具重复 B",
				path: "loop.toolRepeat.enabled"
			},
			{
				label: "无进展 C",
				path: "loop.noProgress.enabled"
			},
			{
				label: "工具超时 D",
				path: "loop.toolTimeout.enabled"
			},
			{
				label: "无落地 E",
				path: "loop.noLanding.enabled"
			},
			{
				label: "硬上限 F",
				path: "loop.hardCap.enabled"
			},
			{
				label: "无证据完成 G",
				path: "loop.noEvidence.enabled"
			}
		];
		const LoopTab = ({ snapshot, onToggle }) => {
			const row = {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 6
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "10px 12px",
					display: "flex",
					flexDirection: "column",
					gap: 8
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: 2
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 13,
							fontWeight: 600,
							color: "#161616"
						},
						children: "🔁 循环守护"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 11,
							color: "#8a8a8a"
						},
						children: "实时循环/卡死打断 · 详细参数在 设置→插件配置"
					})]
				}), LOOP_TOGGLES.map((f) => {
					const on = Boolean(getAt(snapshot, f.path));
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 12,
								color: "#3a3a3a"
							},
							children: f.label
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							role: "switch",
							"aria-checked": on,
							onClick: () => onToggle(f.path, !on),
							style: {
								position: "relative",
								width: 40,
								height: 22,
								borderRadius: 11,
								cursor: "pointer",
								background: on ? "#0969da" : "#d0d0d0",
								border: "none",
								flexShrink: 0
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
								position: "absolute",
								top: 2,
								left: on ? 20 : 2,
								width: 18,
								height: 18,
								borderRadius: "50%",
								background: "#fff",
								boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
								transition: "left 0.2s"
							} })
						})]
					}, f.path);
				})]
			});
		};
		const ModeTab = ({ ctx, snapshot, onModeChange }) => {
			const [queue, setQueue] = (0, react.useState)([]);
			const mode = getAt(snapshot, "mode.mode") ?? "planning";
			(0, react.useEffect)(() => {
				let alive = true;
				const load = async () => {
					try {
						const state = await callBackend(ctx, "getState");
						if (alive && state && Array.isArray(state.pending)) setQueue(state.pending);
					} catch {}
				};
				load();
				const offQueue = ctx.on("sentinel/mode/queue-updated", (q) => setQueue(q));
				const offMode = ctx.on("sentinel/mode/mode-changed", () => load());
				return () => {
					alive = false;
					offQueue();
					offMode();
				};
			}, [ctx]);
			const switchMode = (next) => {
				if (next !== mode) onModeChange(next);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					height: "100%"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						display: "flex",
						gap: 6,
						padding: "10px 12px",
						borderBottom: "1px solid #eee",
						flexShrink: 0
					},
					children: MODES.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						onClick: () => switchMode(m),
						style: {
							flex: 1,
							padding: "6px 0",
							borderRadius: 6,
							border: "1px solid #ccc",
							background: mode === m ? "#2d7d46" : "#f5f5f5",
							color: mode === m ? "#fff" : "#333",
							fontWeight: mode === m ? "bold" : "normal",
							cursor: "pointer",
							fontSize: 13,
							transition: "all 0.2s"
						},
						children: [
							MODE_ICONS[m],
							" ",
							m.charAt(0).toUpperCase() + m.slice(1)
						]
					}, m))
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						flex: 1,
						overflowY: "auto",
						padding: "8px 12px"
					},
					children: queue.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							color: "#888",
							fontSize: 13,
							textAlign: "center",
							padding: "12px 0"
						},
						children: "📭 挂起队列为空"
					}) : queue.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							padding: "6px 0",
							borderBottom: "1px solid #f0f0f0",
							fontSize: 13
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontFamily: "monospace",
								fontSize: 12,
								color: "#333"
							},
							children: item.tool
						})
					}, item.id))
				})]
			});
		};
		const PanelContent = ({ ctx, snapshot, onToggle, onModeChange }) => {
			const [tab, setTab] = (0, react.useState)("loop");
			const tabStyle = (active) => ({
				flex: 1,
				padding: "7px 0",
				borderRadius: 6,
				border: "1px solid #ccc",
				background: active ? "#0969da" : "#f5f5f5",
				color: active ? "#fff" : "#333",
				fontWeight: active ? "bold" : "normal",
				cursor: "pointer",
				fontSize: 13
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					height: "100%"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "panel-header",
						style: {
							padding: "10px 12px",
							background: "#0969da",
							color: "#fff",
							fontWeight: 600,
							fontSize: 14,
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							flexShrink: 0,
							cursor: "grab",
							userSelect: "none"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "🛡️ Sentinel" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							onClick: () => {
								if (floatingContainer) floatingContainer.style.display = "none";
							},
							style: {
								background: "none",
								border: "none",
								color: "#fff",
								fontSize: 16,
								cursor: "pointer",
								padding: "0 4px"
							},
							children: "✕"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 6,
							padding: "8px 12px",
							borderBottom: "1px solid #eee",
							flexShrink: 0
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: tabStyle(tab === "loop"),
							onClick: () => setTab("loop"),
							children: "🔁 循环守护"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							style: tabStyle(tab === "mode"),
							onClick: () => setTab("mode"),
							children: "🚦 模式守卫"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							overflowY: "auto"
						},
						children: tab === "loop" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoopTab, {
							snapshot,
							onToggle
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModeTab, {
							ctx,
							snapshot,
							onModeChange
						})
					})
				]
			});
		};
		const inject = [
			"remote",
			"remote.settings",
			"connection"
		];
		let floatingRoot = null;
		let floatingContainer = null;
		function renderPanel(ctx) {
			if (!floatingContainer) return;
			const contentDiv = floatingContainer.querySelector(".panel-content");
			if (!contentDiv) return;
			if (!floatingRoot) floatingRoot = (0, react_dom_client.createRoot)(contentDiv);
			floatingRoot.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					padding: "20px",
					textAlign: "center",
					color: "#888"
				},
				children: "⏳ 加载中..."
			}));
			readSnapshot(ctx).then((snapshot) => {
				const refreshQueue = () => {
					floatingRoot.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PanelContent, {
						ctx,
						snapshot,
						onToggle: (path, next) => {
							writeField(ctx, path, next, snapshot);
							snapshot = setAt(snapshot, path, next);
							refreshQueue();
						},
						onModeChange: (next) => {
							writeField(ctx, "mode.mode", next, snapshot);
							snapshot = setAt(snapshot, "mode.mode", next);
							refreshQueue();
						}
					}));
				};
				refreshQueue();
			});
		}
		function apply(ctx) {
			if (floatingContainer && document.body.contains(floatingContainer)) return;
			const container = createFloatingContainer();
			document.body.appendChild(container);
			floatingContainer = container;
			const contentDiv = document.createElement("div");
			contentDiv.className = "panel-content";
			contentDiv.style.cssText = "display: flex; flex-direction: column; height: 100%;";
			container.appendChild(contentDiv);
			renderPanel(ctx);
			(window.__dshIconRegistry ||= []).push({
				id: REGISTRY_ID,
				icon: "🛡️",
				label: "Sentinel",
				packageName: "dsh-sentinel",
				onClick: () => {
					if (!floatingContainer) return;
					const visible = floatingContainer.style.display === "flex";
					floatingContainer.style.display = visible ? "none" : "flex";
					if (!visible) renderPanel(ctx);
				}
			});
			ctx.on("dispose", () => {
				floatingRoot?.unmount();
				floatingRoot = null;
				floatingContainer?.remove();
				floatingContainer = null;
				const reg = window.__dshIconRegistry;
				if (reg) {
					const i = reg.findIndex((e) => e.id === REGISTRY_ID);
					if (i >= 0) reg.splice(i, 1);
				}
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map