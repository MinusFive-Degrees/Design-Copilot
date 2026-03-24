import * as extensionConfig from '../extension.json';

type PrimitiveLike = {
	getState_PrimitiveId(): string;
	getState_PrimitiveType(): string;
};

type ReportContext = 'general' | 'sch' | 'pcb';

type Report = {
	context: ReportContext;
	generatedAt: string;
	lines: Array<string>;
	title: string;
};

type PluginSettings = {
	denseNetThreshold: number;
	selectionPreviewLimit: number;
	topNetCount: number;
	viaRiskThreshold: number;
};

type AiAgentConfig = {
	apiKey: string;
	endpoint: string;
	headersText: string;
	model: string;
	systemPrompt: string;
	temperature: number;
};

type AiAgentTask = 'buildChecklist' | 'customPrompt' | 'suggestFixes' | 'summarizeLatestReport';

type AiAgentResult = {
	content: string;
	endpoint: string;
	generatedAt: string;
	model: string;
	title: string;
};

type PanelActionName =
	| 'highlightTopNet'
	| 'integratedCheck'
	| 'quickAudit'
	| 'runDrc'
	| 'saveDesign'
	| 'selectionSnapshot'
	| 'showHistoryDialog'
	| 'showLatestReportDialog';

type PanelDenseNet = {
	count: number;
	name: string;
};

type PanelAiState = {
	config: AiAgentConfig;
	lastResult?: AiAgentResult;
	ready: boolean;
};

type PanelState = {
	ai: PanelAiState;
	canInspectNets: boolean;
	canRunAudit: boolean;
	canRunDrc: boolean;
	context: ReportContext;
	contextLabel: string;
	denseNets: Array<PanelDenseNet>;
	documentName: string;
	documentSubtitle: string;
	history: Array<Report>;
	latestReport?: Report;
	settings: PluginSettings;
	version: string;
};

type PanelRpcRequest =
	| {
			netName?: string;
			type: 'focusNet' | 'highlightDenseNet';
	  }
	| {
			type: 'clearAiResult' | 'getState' | 'resetSettings';
	  }
	| {
			action: PanelActionName;
			type: 'runAction';
	  }
	| {
			config?: Partial<AiAgentConfig>;
			type: 'updateAiConfig';
	  }
	| {
			prompt?: string;
			task: AiAgentTask;
			type: 'runAiAgent';
	  }
	| {
			settings?: Partial<PluginSettings>;
			type: 'updateSettings';
	  };

type PanelRpcResponse = {
	message: string;
	ok: boolean;
	state: PanelState;
};

const SETTINGS_KEY = 'designPulse.settings';
const REPORT_KEY = 'designPulse.latestReport';
const REPORT_HISTORY_KEY = 'designPulse.reportHistory';
const AI_CONFIG_KEY = 'designPulse.aiConfig';
const AI_RESULT_KEY = 'designPulse.aiResult';
const REPORT_HISTORY_LIMIT = 8;
// eda.sys_IFrame window id cannot contain '.', ' ', '|', '/', '\\', '#', '@'
const PANEL_IFRAME_ID = 'designPulse_controlPanel';
const PANEL_RPC_TOPIC = 'designPulse.panel.rpc';
const PANEL_EVENT_TOPIC = 'designPulse.panel.events';
const DEFAULT_SETTINGS: PluginSettings = {
	topNetCount: 5,
	denseNetThreshold: 8,
	selectionPreviewLimit: 6,
	viaRiskThreshold: 24,
};
const DEFAULT_AI_SYSTEM_PROMPT =
	'你是 Design Copilot 内置的嘉立创 EDA 设计助手。请使用简洁中文输出，只基于给定的报告、上下文和网络统计给出可执行建议，不要捏造未提供的数据。';
const DEFAULT_AI_CONFIG: AiAgentConfig = {
	endpoint: '',
	apiKey: '',
	model: '',
	headersText: '',
	systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
	temperature: 0.3,
};
let panelRpcRegistered = false;

const PCB_TYPE_LABELS: Record<string, string> = {
	Arc: '圆弧走线',
	Attribute: '属性',
	Component: '器件',
	ComponentPad: '器件焊盘',
	Dimension: '尺寸标注',
	Fill: '填充',
	Image: '图像',
	Line: '直线走线',
	Object: '对象',
	Pad: '焊盘',
	Polyline: '折线',
	Pour: '覆铜边框',
	Poured: '覆铜填充',
	Region: '区域',
	String: '文本',
	Via: '过孔',
};

const SCH_TYPE_LABELS: Record<string, string> = {
	Arc: '圆弧',
	Bezier: '贝塞尔曲线',
	Bus: '总线',
	Circle: '圆',
	Component: '器件',
	ComponentPin: '器件引脚',
	Ellipse: '椭圆',
	Object: '对象',
	Pin: '引脚',
	Polygon: '多边形',
	Rectangle: '矩形',
	Text: '文本',
	Wire: '导线',
};

function callGetter<T>(target: unknown, methodName: string): T | undefined {
	if (!target || typeof target !== 'object') {
		return undefined;
	}

	const candidate = (target as Record<string, unknown>)[methodName];
	if (typeof candidate !== 'function') {
		return undefined;
	}

	return (candidate as () => T).call(target);
}

function cleanString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function toPositiveInteger(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function toNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}

	return Math.min(max, Math.max(min, value));
}

function normalizeSettings(value: unknown): PluginSettings {
	if (!value || typeof value !== 'object') {
		return DEFAULT_SETTINGS;
	}

	const raw = value as Partial<PluginSettings>;
	return {
		topNetCount: toPositiveInteger(raw.topNetCount, DEFAULT_SETTINGS.topNetCount),
		denseNetThreshold: toPositiveInteger(raw.denseNetThreshold, DEFAULT_SETTINGS.denseNetThreshold),
		selectionPreviewLimit: toPositiveInteger(raw.selectionPreviewLimit, DEFAULT_SETTINGS.selectionPreviewLimit),
		viaRiskThreshold: toPositiveInteger(raw.viaRiskThreshold, DEFAULT_SETTINGS.viaRiskThreshold),
	};
}

function normalizeAiConfig(value: unknown): AiAgentConfig {
	if (!value || typeof value !== 'object') {
		return DEFAULT_AI_CONFIG;
	}

	const raw = value as Partial<AiAgentConfig>;
	return {
		endpoint: cleanString(raw.endpoint) ?? '',
		apiKey: cleanString(raw.apiKey) ?? '',
		model: cleanString(raw.model) ?? '',
		headersText: typeof raw.headersText === 'string' ? raw.headersText.trim() : '',
		systemPrompt: cleanString(raw.systemPrompt) ?? DEFAULT_AI_SYSTEM_PROMPT,
		temperature: toNumberInRange(raw.temperature, DEFAULT_AI_CONFIG.temperature, 0, 2),
	};
}

function getSettings(): PluginSettings {
	return normalizeSettings(eda.sys_Storage.getExtensionUserConfig(SETTINGS_KEY));
}

async function saveSettings(settings: PluginSettings): Promise<void> {
	const nextSettings = normalizeSettings(settings);
	await eda.sys_Storage.setExtensionUserConfig(SETTINGS_KEY, nextSettings);
	notifyPanelStateChanged('settings');
}

async function ensureSettings(): Promise<PluginSettings> {
	const settings = getSettings();
	const missingRaw = eda.sys_Storage.getExtensionUserConfig(SETTINGS_KEY);
	if (!missingRaw) {
		await saveSettings(settings);
	}
	return settings;
}

function getAiConfig(): AiAgentConfig {
	return normalizeAiConfig(eda.sys_Storage.getExtensionUserConfig(AI_CONFIG_KEY));
}

async function saveAiConfig(config: AiAgentConfig): Promise<void> {
	const nextConfig = normalizeAiConfig(config);
	await eda.sys_Storage.setExtensionUserConfig(AI_CONFIG_KEY, nextConfig);
	notifyPanelStateChanged('ai-config');
}

async function ensureAiConfig(): Promise<AiAgentConfig> {
	const config = getAiConfig();
	const raw = eda.sys_Storage.getExtensionUserConfig(AI_CONFIG_KEY);
	if (!raw) {
		await saveAiConfig(config);
	}
	return config;
}

function increaseCounter(map: Map<string, number>, key: string | undefined): void {
	if (!key) {
		return;
	}

	map.set(key, (map.get(key) ?? 0) + 1);
}

function sortEntriesDescending(map: Map<string, number>): Array<[string, number]> {
	return [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function formatTopEntries(map: Map<string, number>, limit: number): string {
	const entries = sortEntriesDescending(map).slice(0, limit);
	if (!entries.length) {
		return '无';
	}

	return entries.map(([key, value]) => `${key}×${value}`).join('，');
}

function getPrimitiveLabel(context: ReportContext, primitiveType: string): string {
	const labelMap = context === 'pcb' ? PCB_TYPE_LABELS : SCH_TYPE_LABELS;
	return labelMap[primitiveType] ?? primitiveType;
}

function getNetName(target: unknown): string | undefined {
	return cleanString(callGetter<string | undefined>(target, 'getState_Net'));
}

function getDesignator(target: unknown): string | undefined {
	return cleanString(callGetter<string | undefined>(target, 'getState_Designator'));
}

function getComponentType(target: unknown): string | undefined {
	return cleanString(callGetter<string | undefined>(target, 'getState_ComponentType'));
}

function getBooleanState(target: unknown, methodName: string): boolean | undefined {
	return callGetter<boolean | undefined>(target, methodName);
}

function getLayer(target: unknown): string | undefined {
	return cleanString(callGetter<string | undefined>(target, 'getState_Layer'));
}

function getPrefix(designator: string | undefined): string {
	if (!designator) {
		return '未命名';
	}

	const match = /^[A-Za-z]+/.exec(designator);
	return match ? match[0].toUpperCase() : '其它';
}

function createTimestamp(): string {
	const now = new Date();
	const pad = (value: number) => `${value}`.padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function isReport(value: unknown): value is Report {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<Report>;
	return (
		typeof candidate.context === 'string' &&
		typeof candidate.generatedAt === 'string' &&
		Array.isArray(candidate.lines) &&
		typeof candidate.title === 'string'
	);
}

function getLatestReport(): Report | undefined {
	const report = eda.sys_Storage.getExtensionUserConfig(REPORT_KEY);
	return isReport(report) ? report : undefined;
}

function getReportHistory(): Array<Report> {
	const history = eda.sys_Storage.getExtensionUserConfig(REPORT_HISTORY_KEY);
	return Array.isArray(history) ? history.filter(isReport).slice(0, REPORT_HISTORY_LIMIT) : [];
}

function isAiAgentResult(value: unknown): value is AiAgentResult {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<AiAgentResult>;
	return (
		typeof candidate.content === 'string' &&
		typeof candidate.endpoint === 'string' &&
		typeof candidate.generatedAt === 'string' &&
		typeof candidate.model === 'string' &&
		typeof candidate.title === 'string'
	);
}

function getAiLastResult(): AiAgentResult | undefined {
	const result = eda.sys_Storage.getExtensionUserConfig(AI_RESULT_KEY);
	return isAiAgentResult(result) ? result : undefined;
}

async function storeAiResult(result?: AiAgentResult): Promise<void> {
	await eda.sys_Storage.setExtensionUserConfig(AI_RESULT_KEY, result ?? null);
	notifyPanelStateChanged('ai-result');
}

function notifyPanelStateChanged(reason: string): void {
	try {
		eda.sys_MessageBus.publishPublic(PANEL_EVENT_TOPIC, {
			generatedAt: createTimestamp(),
			reason,
		});
	} catch (error) {
		eda.sys_Log.add(`Design Copilot panel event skipped: ${String(error)}`);
	}
}

async function getCurrentContext(): Promise<ReportContext> {
	const documentInfo = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	if (documentInfo?.documentType === 1) {
		return 'sch';
	}
	if (documentInfo?.documentType === 3) {
		return 'pcb';
	}
	return 'general';
}

async function storeReport(report: Report): Promise<void> {
	const history = getReportHistory();
	const nextHistory = [report, ...history.filter((item) => !(item.generatedAt === report.generatedAt && item.title === report.title))].slice(
		0,
		REPORT_HISTORY_LIMIT,
	);
	await eda.sys_Storage.setExtensionUserConfig(REPORT_KEY, report);
	await eda.sys_Storage.setExtensionUserConfig(REPORT_HISTORY_KEY, nextHistory);
	notifyPanelStateChanged('report');
}

function formatReport(report: Report): string {
	return [report.title, `生成时间：${report.generatedAt}`, '', ...report.lines].join('\n');
}

async function recordReport(report: Report): Promise<Report> {
	await storeReport(report);
	return report;
}

async function presentReport(report: Report): Promise<void> {
	await recordReport(report);
	eda.sys_Dialog.showInformationMessage(formatReport(report), report.title, '关闭');
}

function showToast(message: string): void {
	eda.sys_Message.showToastMessage(message, 'info', 3);
}

async function runWithLoading<T>(title: string, callback: () => Promise<T>): Promise<T> {
	eda.sys_LoadingAndProgressBar.showLoading();
	showToast(title);
	try {
		return await callback();
	} finally {
		eda.sys_LoadingAndProgressBar.destroyLoading();
	}
}

function summarizeSelection(context: ReportContext, primitives: Array<PrimitiveLike>, settings: PluginSettings): Array<string> {
	const typeCounter = new Map<string, number>();
	const netCounter = new Map<string, number>();
	const designatorList: Array<string> = [];

	for (const primitive of primitives) {
		const primitiveType = primitive.getState_PrimitiveType();
		increaseCounter(typeCounter, getPrimitiveLabel(context, primitiveType));
		increaseCounter(netCounter, getNetName(primitive));

		const designator = getDesignator(primitive);
		if (designator) {
			designatorList.push(designator);
		}
	}

	const preview = designatorList.slice(0, settings.selectionPreviewLimit);
	return [
		`选中图元：${primitives.length}`,
		`类型分布：${formatTopEntries(typeCounter, settings.selectionPreviewLimit)}`,
		`网络分布：${formatTopEntries(netCounter, settings.topNetCount)}`,
		preview.length ? `位号预览：${preview.join('，')}` : '位号预览：无器件位号',
	];
}

function buildRiskLine(label: string, value: number, threshold: number): string {
	const state = value >= threshold ? '偏高' : '可接受';
	return `${label}：${value}（阈值 ${threshold}，${state}）`;
}

function calculateReadinessScore(total: number, issues: number): number {
	if (total <= 0) {
		return 100;
	}

	return Math.max(0, Math.round((1 - issues / total) * 100));
}

function averageScore(...scores: Array<number>): number {
	if (!scores.length) {
		return 100;
	}

	return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function formatScoreBadge(score: number): string {
	if (score >= 90) {
		return 'A 优';
	}
	if (score >= 80) {
		return 'B 稳';
	}
	if (score >= 70) {
		return 'C 需关注';
	}
	return 'D 风险高';
}

function formatSuggestionLine(suggestions: Array<string>, fallback: string): string {
	return `建议动作：${suggestions.length ? suggestions.join('；') : fallback}`;
}

function formatSettingsSummary(settings: PluginSettings): string {
	return `阈值：TopNet=${settings.topNetCount} / DenseNet=${settings.denseNetThreshold} / 选区预览=${settings.selectionPreviewLimit} / ViaRisk=${settings.viaRiskThreshold}`;
}

function buildAiState(config: AiAgentConfig): PanelAiState {
	return {
		config,
		lastResult: getAiLastResult(),
		ready: Boolean(config.endpoint && config.model),
	};
}

function maskEndpoint(endpoint: string): string {
	try {
		const url = new URL(endpoint);
		return `${url.origin}${url.pathname}`;
	} catch {
		return endpoint;
	}
}

function parseAiHeaders(headersText: string): Record<string, string> {
	const trimmed = headersText.trim();
	if (!trimmed) {
		return {};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		throw new Error('AI 自定义请求头不是合法 JSON，请使用 {"Header":"Value"} 形式。');
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('AI 自定义请求头必须是 JSON 对象。');
	}

	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		const headerName = cleanString(key);
		if (!headerName) {
			continue;
		}

		const headerValue = typeof value === 'string' ? value.trim() : `${value ?? ''}`.trim();
		if (headerValue) {
			headers[headerName] = headerValue;
		}
	}

	return headers;
}

function normalizeTextArray(values: Array<string | undefined>): Array<string> {
	return values.map((value) => cleanString(value)).filter((value): value is string => Boolean(value));
}

function normalizeMessageContent(content: unknown): string | undefined {
	if (typeof content === 'string') {
		return cleanString(content);
	}

	if (!Array.isArray(content)) {
		return undefined;
	}

	const chunks: Array<string> = [];
	for (const item of content) {
		if (typeof item === 'string') {
			const value = cleanString(item);
			if (value) {
				chunks.push(value);
			}
			continue;
		}

		if (!item || typeof item !== 'object') {
			continue;
		}

		const objectItem = item as Record<string, unknown>;
		const value = cleanString(
			typeof objectItem.text === 'string' ? objectItem.text : typeof objectItem.content === 'string' ? objectItem.content : undefined,
		);
		if (value) {
			chunks.push(value);
		}
	}

	return chunks.length ? chunks.join('\n\n') : undefined;
}

function extractAiResponseText(payload: unknown): string | undefined {
	if (!payload || typeof payload !== 'object') {
		return undefined;
	}

	const candidate = payload as Record<string, unknown>;
	const direct = normalizeTextArray([
		typeof candidate.output_text === 'string' ? candidate.output_text : undefined,
		typeof candidate.result === 'string' ? candidate.result : undefined,
		typeof candidate.content === 'string' ? candidate.content : undefined,
	]).join('\n\n');
	if (direct) {
		return direct;
	}

	if (Array.isArray(candidate.output)) {
		const outputText = normalizeTextArray(
			candidate.output.flatMap((item) => {
				if (!item || typeof item !== 'object') {
					return [];
				}

				const outputItem = item as Record<string, unknown>;
				if (Array.isArray(outputItem.content)) {
					return outputItem.content.map((contentItem) => {
						if (!contentItem || typeof contentItem !== 'object') {
							return undefined;
						}

						const contentRecord = contentItem as Record<string, unknown>;
						return typeof contentRecord.text === 'string' ? contentRecord.text : undefined;
					});
				}

				return typeof outputItem.text === 'string' ? [outputItem.text] : [];
			}),
		);
		if (outputText.length) {
			return outputText.join('\n\n');
		}
	}

	if (Array.isArray(candidate.choices) && candidate.choices.length > 0) {
		const choice = candidate.choices[0];
		if (choice && typeof choice === 'object') {
			const record = choice as Record<string, unknown>;
			const message = record.message as Record<string, unknown> | undefined;
			const messageText = normalizeTextArray([
				normalizeMessageContent(message?.content),
				typeof record.text === 'string' ? record.text : undefined,
			]).join('\n\n');
			if (messageText) {
				return messageText;
			}
		}
	}

	return undefined;
}

function formatAiTaskTitle(task: AiAgentTask): string {
	switch (task) {
		case 'summarizeLatestReport':
			return 'AI 报告总结';
		case 'suggestFixes':
			return 'AI 整改建议';
		case 'buildChecklist':
			return 'AI 复核清单';
		case 'customPrompt':
			return 'AI 自定义问答';
	}
}

async function buildAiPrompt(task: AiAgentTask, prompt?: string): Promise<string> {
	const [context, settings] = await Promise.all([getCurrentContext(), ensureSettings()]);
	const latestReport = getLatestReport();
	const documentSummary = await getPanelDocumentSummary(context);
	const denseNets = context === 'pcb' ? await collectCurrentPcbDenseNetEntries(settings, settings.topNetCount, settings.denseNetThreshold) : [];

	if (!latestReport && task !== 'customPrompt') {
		throw new Error('请先生成至少一份报告，再调用 AI 助手。');
	}

	const sections = [
		`当前上下文：${documentSummary.contextLabel}`,
		`当前文档：${documentSummary.documentName}`,
		`文档说明：${documentSummary.documentSubtitle}`,
		formatSettingsSummary(settings),
		`PCB 热点网络：${denseNets.length ? denseNets.map(([name, count]) => `${name}×${count}`).join('，') : '当前无热点网络或不在 PCB 上下文'}`,
		latestReport ? `最近报告：\n${formatReport(latestReport)}` : '最近报告：暂无',
	].join('\n\n');

	switch (task) {
		case 'summarizeLatestReport':
			return [
				'请把下面这份嘉立创 EDA 检查报告总结为 3 到 5 条高信号结论。',
				'输出要求：',
				'1. 先给总体状态判断',
				'2. 再列关键风险点',
				'3. 最后给下一步建议',
				sections,
			].join('\n\n');
		case 'suggestFixes':
			return [
				'请基于下面的嘉立创 EDA 检查报告给出整改建议。',
				'输出要求：',
				'1. 按优先级列出问题',
				'2. 每条包含问题、原因、建议动作',
				'3. 优先使用原理图与 PCB 工程语境',
				sections,
			].join('\n\n');
		case 'buildChecklist':
			return [
				'请基于下面的检查结果生成下一轮设计复核清单。',
				'输出要求：',
				'1. 用可执行核对项表达',
				'2. 优先覆盖 DRC、BOM、热点网络和器件完整性',
				'3. 每项尽量可在嘉立创 EDA 内直接验证',
				sections,
			].join('\n\n');
		case 'customPrompt': {
			const userPrompt = cleanString(prompt);
			if (!userPrompt) {
				throw new Error('请输入自定义提问内容。');
			}

			return [`用户问题：${userPrompt}`, '请仅基于以下设计上下文回答。', sections].join('\n\n');
		}
	}
}

async function runAiAgentTask(task: AiAgentTask, prompt?: string): Promise<AiAgentResult> {
	const config = await ensureAiConfig();
	if (!config.endpoint || !config.model) {
		throw new Error('请先在 AI 助手区填写模型接口地址和模型名。');
	}

	const headers = {
		'Content-Type': 'application/json',
		...parseAiHeaders(config.headersText),
	};
	if (config.apiKey && !headers.Authorization) {
		headers.Authorization = `Bearer ${config.apiKey}`;
	}

	const payload = {
		model: config.model,
		messages: [
			{
				role: 'system',
				content: config.systemPrompt,
			},
			{
				role: 'user',
				content: await buildAiPrompt(task, prompt),
			},
		],
		temperature: config.temperature,
	};

	const response = await eda.sys_ClientUrl.request(config.endpoint, 'POST', JSON.stringify(payload), {
		headers,
	});
	const rawText = await response.text();
	if (!response.ok) {
		const reason = cleanString(rawText)?.slice(0, 300) ?? `HTTP ${response.status}`;
		throw new Error(`AI 接口请求失败：${response.status} ${reason}`);
	}

	let parsed: unknown;
	try {
		parsed = rawText ? JSON.parse(rawText) : {};
	} catch {
		throw new Error('AI 接口返回的不是 JSON，当前仅支持 OpenAI 兼容响应。');
	}

	const content = extractAiResponseText(parsed);
	if (!content) {
		throw new Error('AI 接口返回成功，但未找到可展示的文本内容。请确认接口兼容 chat/completions 响应格式。');
	}

	const result: AiAgentResult = {
		content,
		endpoint: maskEndpoint(config.endpoint),
		generatedAt: createTimestamp(),
		model: config.model,
		title: formatAiTaskTitle(task),
	};
	await storeAiResult(result);
	return result;
}

function collectPcbNetCounter(components: Array<unknown>, vias: Array<unknown>, lines: Array<unknown>, arcs: Array<unknown>): Map<string, number> {
	const netCounter = new Map<string, number>();

	for (const component of components) {
		const pads = callGetter<Array<{ net?: string }>>(component, 'getState_Pads');
		if (!Array.isArray(pads)) {
			continue;
		}

		for (const pad of pads) {
			increaseCounter(netCounter, cleanString(pad.net));
		}
	}

	for (const primitive of [...vias, ...lines, ...arcs]) {
		increaseCounter(netCounter, getNetName(primitive));
	}

	return netCounter;
}

function getDenseNetEntries(netCounter: Map<string, number>, limit: number, threshold?: number): Array<[string, number]> {
	return sortEntriesDescending(netCounter)
		.filter((entry) => (threshold ? entry[1] >= threshold : true))
		.slice(0, limit);
}

function formatDenseNetEntries(entries: Array<[string, number]>): string {
	if (!entries.length) {
		return '无';
	}

	return entries.map(([net, count]) => `${net}×${count}`).join('，');
}

async function collectCurrentPcbDenseNetEntries(
	settings: PluginSettings,
	limit: number = settings.topNetCount,
	threshold?: number,
): Promise<Array<[string, number]>> {
	const [components, vias, lines, arcs] = await Promise.all([
		eda.pcb_PrimitiveComponent.getAll(),
		eda.pcb_PrimitiveVia.getAll(),
		eda.pcb_PrimitiveLine.getAll(),
		eda.pcb_PrimitiveArc.getAll(),
	]);

	return getDenseNetEntries(collectPcbNetCounter(components, vias, lines, arcs), limit, threshold);
}

async function buildSchematicReport(): Promise<Report> {
	const settings = await ensureSettings();
	const [boardInfo, schematicInfo, pageInfo, currentDocumentInfo, teamInfo, workspaceInfo, components, wires, texts, buses, selectedPrimitives] =
		await Promise.all([
			eda.dmt_Board.getCurrentBoardInfo(),
			eda.dmt_Schematic.getCurrentSchematicInfo(),
			eda.dmt_Schematic.getCurrentSchematicPageInfo(),
			eda.dmt_SelectControl.getCurrentDocumentInfo(),
			eda.dmt_Team.getCurrentTeamInfo(),
			eda.dmt_Workspace.getCurrentWorkspaceInfo(),
			eda.sch_PrimitiveComponent.getAll(),
			eda.sch_PrimitiveWire.getAll(),
			eda.sch_PrimitiveText.getAll(),
			eda.sch_PrimitiveBus.getAll(),
			eda.sch_SelectControl.getAllSelectedPrimitives(),
		]);
	const projectInfo = currentDocumentInfo?.parentProjectUuid
		? await eda.dmt_Project.getProjectInfo(currentDocumentInfo.parentProjectUuid)
		: undefined;

	const componentPrefixCounter = new Map<string, number>();
	let realComponentCount = 0;
	let excludedFromBomCount = 0;
	let excludedFromPcbCount = 0;
	let unnamedDesignatorCount = 0;
	let missingFootprintCount = 0;
	let netMarkerCount = 0;

	for (const component of components) {
		const componentType = getComponentType(component);
		if (componentType === 'part') {
			realComponentCount += 1;
			const designator = getDesignator(component);
			increaseCounter(componentPrefixCounter, getPrefix(designator));
			if (!designator) {
				unnamedDesignatorCount += 1;
			}
			if (getBooleanState(component, 'getState_AddIntoBom') === false) {
				excludedFromBomCount += 1;
			}
			if (getBooleanState(component, 'getState_AddIntoPcb') === false) {
				excludedFromPcbCount += 1;
			}
			if (!callGetter(component, 'getState_Footprint')) {
				missingFootprintCount += 1;
			}
		}

		if (componentType === 'netflag' || componentType === 'netport') {
			netMarkerCount += 1;
		}
	}

	const bomReadinessScore = calculateReadinessScore(
		realComponentCount,
		excludedFromBomCount + excludedFromPcbCount + missingFootprintCount + unnamedDesignatorCount,
	);
	const schematicSuggestions: Array<string> = [];
	if (missingFootprintCount > 0) {
		schematicSuggestions.push(`补齐 ${missingFootprintCount} 个器件封装`);
	}
	if (unnamedDesignatorCount > 0) {
		schematicSuggestions.push(`补齐 ${unnamedDesignatorCount} 个位号`);
	}
	if (excludedFromPcbCount > 0) {
		schematicSuggestions.push(`复核 ${excludedFromPcbCount} 个不下推 PCB 的器件`);
	}
	const designScore = averageScore(
		bomReadinessScore,
		calculateReadinessScore(realComponentCount, missingFootprintCount + unnamedDesignatorCount),
		calculateReadinessScore(realComponentCount, excludedFromPcbCount),
	);

	return {
		context: 'sch',
		generatedAt: createTimestamp(),
		title: 'Design Copilot 原理图体检',
		lines: [
			`板子：${boardInfo?.name ?? '未关联板子'}`,
			`原理图：${schematicInfo?.name ?? '未知原理图'} / 当前页：${pageInfo?.name ?? '未知页'}`,
			`设计评分：${designScore}/100（${formatScoreBadge(designScore)}）`,
			formatSuggestionLine(schematicSuggestions, '可进入下一轮 PCB 联动检查'),
			`元件：${realComponentCount}，导线：${wires.length}，总线：${buses.length}，文本：${texts.length}`,
			`网络标识：${netMarkerCount}，当前选区：${selectedPrimitives.length}`,
			`位号前缀 Top：${formatTopEntries(componentPrefixCounter, settings.topNetCount)}`,
			`BOM 准备度：${bomReadinessScore}%`,
			`不参与 BOM：${excludedFromBomCount}，不下推 PCB：${excludedFromPcbCount}`,
			`缺少位号：${unnamedDesignatorCount}，缺少封装：${missingFootprintCount}`,
			...summarizeSelection('sch', selectedPrimitives, settings),
		],
	};
}

async function buildPcbReport(): Promise<Report> {
	const settings = await ensureSettings();
	const [
		boardInfo,
		pcbInfo,
		currentDocumentInfo,
		teamInfo,
		workspaceInfo,
		components,
		pads,
		vias,
		lines,
		arcs,
		pours,
		fills,
		regions,
		strings,
		selectedPrimitives,
	] = await Promise.all([
		eda.dmt_Board.getCurrentBoardInfo(),
		eda.dmt_Pcb.getCurrentPcbInfo(),
		eda.dmt_SelectControl.getCurrentDocumentInfo(),
		eda.dmt_Team.getCurrentTeamInfo(),
		eda.dmt_Workspace.getCurrentWorkspaceInfo(),
		eda.pcb_PrimitiveComponent.getAll(),
		eda.pcb_PrimitivePad.getAll(),
		eda.pcb_PrimitiveVia.getAll(),
		eda.pcb_PrimitiveLine.getAll(),
		eda.pcb_PrimitiveArc.getAll(),
		eda.pcb_PrimitivePour.getAll(),
		eda.pcb_PrimitiveFill.getAll(),
		eda.pcb_PrimitiveRegion.getAll(),
		eda.pcb_PrimitiveString.getAll(),
		eda.pcb_SelectControl.getAllSelectedPrimitives(),
	]);
	const projectInfo = currentDocumentInfo?.parentProjectUuid
		? await eda.dmt_Project.getProjectInfo(currentDocumentInfo.parentProjectUuid)
		: undefined;

	const layerCounter = new Map<string, number>();
	const componentPrefixCounter = new Map<string, number>();
	const denseNets = collectPcbNetCounter(components, vias, lines, arcs);
	const denseNetEntries = getDenseNetEntries(denseNets, settings.topNetCount, settings.denseNetThreshold);
	let bomExcludedCount = 0;
	let missingSupplierCount = 0;
	let missingManufacturerCount = 0;

	for (const component of components) {
		increaseCounter(componentPrefixCounter, getPrefix(getDesignator(component)));
		increaseCounter(layerCounter, getLayer(component));

		if (getBooleanState(component, 'getState_AddIntoBom') === false) {
			bomExcludedCount += 1;
		}
		if (!cleanString(callGetter<string | undefined>(component, 'getState_SupplierId'))) {
			missingSupplierCount += 1;
		}
		if (!cleanString(callGetter<string | undefined>(component, 'getState_ManufacturerId'))) {
			missingManufacturerCount += 1;
		}
	}

	const bomReadinessScore = calculateReadinessScore(components.length, bomExcludedCount + missingSupplierCount + missingManufacturerCount);
	const pcbSuggestions: Array<string> = [];
	if (missingSupplierCount + missingManufacturerCount > 0) {
		pcbSuggestions.push('补齐器件供应链料号');
	}
	if (denseNetEntries.length > 0) {
		pcbSuggestions.push(`优先复核 ${denseNetEntries[0][0]} 等高连接网络`);
	}
	if (vias.length >= settings.viaRiskThreshold) {
		pcbSuggestions.push(`关注过孔总量 ${vias.length}`);
	}
	const designScore = averageScore(
		bomReadinessScore,
		Math.max(0, 100 - denseNetEntries.length * 12),
		Math.max(0, 100 - Math.max(0, vias.length - settings.viaRiskThreshold) * 2),
	);

	return {
		context: 'pcb',
		generatedAt: createTimestamp(),
		title: 'Design Copilot PCB 体检',
		lines: [
			`板子：${boardInfo?.name ?? pcbInfo?.parentBoardName ?? '未关联板子'}`,
			`PCB：${pcbInfo?.name ?? '未知 PCB'}`,
			`设计评分：${designScore}/100（${formatScoreBadge(designScore)}）`,
			formatSuggestionLine(pcbSuggestions, '可进入走线细化或出板前复核'),
			`器件：${components.length}，焊盘：${pads.length}，过孔：${vias.length}`,
			`走线：${lines.length}，圆弧：${arcs.length}，覆铜边框：${pours.length}`,
			`填充：${fills.length}，区域：${regions.length}，文本：${strings.length}`,
			`器件层分布：${formatTopEntries(layerCounter, 2)}`,
			`位号前缀 Top：${formatTopEntries(componentPrefixCounter, settings.topNetCount)}`,
			`网络密度 Top：${formatDenseNetEntries(denseNetEntries)}`,
			`BOM 准备度：${bomReadinessScore}%`,
			`不参与 BOM：${bomExcludedCount}，缺供应商料号：${missingSupplierCount}，缺制造商料号：${missingManufacturerCount}`,
			buildRiskLine('过孔密度提示', vias.length, settings.viaRiskThreshold),
			formatSettingsSummary(settings),
			...summarizeSelection('pcb', selectedPrimitives, settings),
		],
	};
}
function parseSettingsText(value: string): PluginSettings | undefined {
	try {
		const parsed = JSON.parse(value) as unknown;
		return normalizeSettings(parsed);
	} catch (error) {
		eda.sys_Dialog.showInformationMessage(`设置解析失败：${String(error)}`, 'Design Copilot 设置', '关闭');
		return undefined;
	}
}

async function buildSelectionReport(context: ReportContext): Promise<Report> {
	const settings = await ensureSettings();
	const primitives =
		context === 'pcb' ? await eda.pcb_SelectControl.getAllSelectedPrimitives() : await eda.sch_SelectControl.getAllSelectedPrimitives();
	const title = context === 'pcb' ? 'Design Copilot PCB 选区快照' : 'Design Copilot 原理图选区快照';
	const documentName =
		context === 'pcb'
			? ((await eda.dmt_Pcb.getCurrentPcbInfo())?.name ?? '未知 PCB')
			: ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.name ?? '未知页');

	return {
		context,
		generatedAt: createTimestamp(),
		title,
		lines: [`当前文档：${documentName}`, ...summarizeSelection(context, primitives, settings)],
	};
}

async function showSelectionReport(context: ReportContext): Promise<void> {
	await presentReport(await buildSelectionReport(context));
}

async function buildSchematicDrcReport(): Promise<Report> {
	const pageInfo = await eda.dmt_Schematic.getCurrentSchematicPageInfo();
	const passed = await eda.sch_Drc.check(false, false);
	return {
		context: 'sch',
		generatedAt: createTimestamp(),
		title: 'Design Copilot 原理图 DRC',
		lines: [
			`当前页：${pageInfo?.name ?? '未知页'}`,
			passed ? '结果：未发现阻断性错误。' : '结果：存在需要关注的 DRC 问题，请打开原理图 DRC 面板进一步检查。',
		],
	};
}

async function buildPcbDrcReport(): Promise<Report> {
	const [pcbInfo, ruleName, issues] = await Promise.all([
		eda.dmt_Pcb.getCurrentPcbInfo(),
		eda.pcb_Drc.getCurrentRuleConfigurationName(),
		eda.pcb_Drc.check(true, false, true),
	]);

	return {
		context: 'pcb',
		generatedAt: createTimestamp(),
		title: 'Design Copilot PCB DRC',
		lines: [
			`当前 PCB：${pcbInfo?.name ?? '未知 PCB'}`,
			`规则配置：${ruleName ?? '未知规则'}`,
			`问题数：${issues.length}`,
			issues.length === 0 ? '结果：当前 PCB DRC 通过。' : '结果：存在 DRC 问题，请打开 PCB DRC 面板查看明细。',
		],
	};
}

function createFallbackPanelState(): PanelState {
	const aiConfig = getAiConfig();
	return {
		ai: buildAiState(aiConfig),
		canInspectNets: false,
		canRunAudit: false,
		canRunDrc: false,
		context: 'general',
		contextLabel: '首页 / 其它',
		denseNets: [],
		documentName: '无活动设计文档',
		documentSubtitle: '切换到原理图或 PCB 以启用完整分析动作。',
		history: getReportHistory(),
		latestReport: getLatestReport(),
		settings: getSettings(),
		version: extensionConfig.version,
	};
}

async function getPanelDocumentSummary(context: ReportContext): Promise<{ contextLabel: string; documentName: string; documentSubtitle: string }> {
	if (context === 'sch') {
		const pageInfo = await eda.dmt_Schematic.getCurrentSchematicPageInfo();
		return {
			contextLabel: '原理图',
			documentName: pageInfo?.name ?? '当前原理图页',
			documentSubtitle: '适合执行体检、选区快照与原理图 DRC。',
		};
	}

	if (context === 'pcb') {
		const pcbInfo = await eda.dmt_Pcb.getCurrentPcbInfo();
		return {
			contextLabel: 'PCB',
			documentName: pcbInfo?.name ?? '当前 PCB',
			documentSubtitle: '支持高密网络分析、网络聚焦与 PCB DRC。',
		};
	}

	return {
		contextLabel: '首页 / 其它',
		documentName: '无活动设计文档',
		documentSubtitle: '切换到原理图或 PCB 以启用完整分析动作。',
	};
}

async function buildPanelState(): Promise<PanelState> {
	const [context, settings, aiConfig] = await Promise.all([getCurrentContext(), ensureSettings(), ensureAiConfig()]);
	const [documentSummary, denseNets] = await Promise.all([
		getPanelDocumentSummary(context),
		context === 'pcb'
			? collectCurrentPcbDenseNetEntries(settings, Math.max(settings.topNetCount, REPORT_HISTORY_LIMIT), settings.denseNetThreshold).then(
					(entries) => entries.map(([name, count]) => ({ count, name })),
				)
			: Promise.resolve([] as Array<PanelDenseNet>),
	]);

	return {
		ai: buildAiState(aiConfig),
		canInspectNets: context === 'pcb',
		canRunAudit: context === 'sch' || context === 'pcb',
		canRunDrc: context === 'sch' || context === 'pcb',
		context,
		contextLabel: documentSummary.contextLabel,
		denseNets,
		documentName: documentSummary.documentName,
		documentSubtitle: documentSummary.documentSubtitle,
		history: getReportHistory(),
		latestReport: getLatestReport(),
		settings,
		version: extensionConfig.version,
	};
}

async function buildPanelResponse(ok: boolean, message: string): Promise<PanelRpcResponse> {
	try {
		return {
			message,
			ok,
			state: await buildPanelState(),
		};
	} catch (error) {
		eda.sys_Log.add(`Design Copilot panel state fallback: ${String(error)}`);
		return {
			message,
			ok,
			state: createFallbackPanelState(),
		};
	}
}

function getPanelActionLoadingTitle(action: PanelActionName): string {
	switch (action) {
		case 'integratedCheck':
			return '正在生成综合检查报告...';
		case 'quickAudit':
			return '正在执行快速体检...';
		case 'selectionSnapshot':
			return '正在整理当前选区...';
		case 'runDrc':
			return '正在执行 DRC 检查...';
		case 'saveDesign':
			return '正在保存当前设计...';
		case 'highlightTopNet':
			return '正在分析高密度网络...';
		case 'showHistoryDialog':
			return '正在打开报告历史...';
		case 'showLatestReportDialog':
			return '正在打开最近报告...';
	}
}

function getAiTaskLoadingTitle(task: AiAgentTask): string {
	switch (task) {
		case 'summarizeLatestReport':
			return '正在生成 AI 报告总结...';
		case 'suggestFixes':
			return '正在生成 AI 整改建议...';
		case 'buildChecklist':
			return '正在生成 AI 复核清单...';
		case 'customPrompt':
			return '正在请求 AI 助手...';
	}
}

async function selectPcbNetByName(targetNet: string, messagePrefix: string = '已高亮网络'): Promise<string> {
	await eda.pcb_SelectControl.clearSelected();
	await eda.pcb_SelectControl.doCrossProbeSelect(undefined, undefined, [targetNet], true, true);
	const message = `${messagePrefix} ${targetNet}`;
	showToast(message);
	return message;
}

async function runPanelAction(action: PanelActionName): Promise<string> {
	if (action === 'showLatestReportDialog') {
		showLatestReport();
		return '已打开最近报告弹窗';
	}

	if (action === 'showHistoryDialog') {
		showReportHistory();
		return '已打开报告历史弹窗';
	}

	if (action === 'saveDesign') {
		const currentDocument = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		const documentType = currentDocument?.documentType;
		const saved =
			documentType === 1 ? await eda.sch_Document.save() : documentType === 3 ? await eda.pcb_Document.save() : await eda.pnl_Document.save();
		const message = saved ? '当前设计已保存' : '保存失败，请检查文档状态';
		showToast(message);
		return message;
	}

	const context = await getCurrentContext();
	if (action === 'highlightTopNet') {
		if (context !== 'pcb') {
			return '请先切换到 PCB 页面，再执行高密度网络分析。';
		}

		const settings = await ensureSettings();
		const denseNets = await collectCurrentPcbDenseNetEntries(settings, settings.topNetCount, settings.denseNetThreshold);
		const fallbackNets = denseNets.length ? denseNets : await collectCurrentPcbDenseNetEntries(settings, 1);
		const targetNet = denseNets[0] ?? fallbackNets[0];
		if (!targetNet) {
			return '当前 PCB 中没有可用于分析的网络。';
		}

		return selectPcbNetByName(targetNet[0], '已高亮最密网络');
	}

	if (context !== 'sch' && context !== 'pcb') {
		return '请先切换到原理图页或 PCB 页，再执行当前动作。';
	}

	switch (action) {
		case 'integratedCheck':
			await recordReport(context === 'sch' ? await buildIntegratedSchematicReport() : await buildIntegratedPcbReport());
			return context === 'sch' ? '已生成原理图综合检查' : '已生成 PCB 综合检查';
		case 'quickAudit':
			await recordReport(context === 'sch' ? await buildSchematicReport() : await buildPcbReport());
			return context === 'sch' ? '已完成原理图快速体检' : '已完成 PCB 快速体检';
		case 'selectionSnapshot':
			await recordReport(await buildSelectionReport(context));
			return context === 'sch' ? '已生成原理图选区快照' : '已生成 PCB 选区快照';
		case 'runDrc':
			await recordReport(context === 'sch' ? await buildSchematicDrcReport() : await buildPcbDrcReport());
			return context === 'sch' ? '已完成原理图 DRC' : '已完成 PCB DRC';
		default:
			return '未支持的动作';
	}
}

async function handlePanelRpc(request?: PanelRpcRequest): Promise<PanelRpcResponse> {
	try {
		switch (request?.type ?? 'getState') {
			case 'clearAiResult':
				await storeAiResult(undefined);
				return buildPanelResponse(true, 'AI 结果已清空');
			case 'getState':
				return buildPanelResponse(true, '工作台状态已刷新');
			case 'resetSettings':
				await saveSettings(DEFAULT_SETTINGS);
				return buildPanelResponse(true, '设置已恢复默认值');
			case 'updateAiConfig': {
				const nextConfig = normalizeAiConfig({
					...getAiConfig(),
					...request.config,
				});
				parseAiHeaders(nextConfig.headersText);
				await saveAiConfig(nextConfig);
				return buildPanelResponse(true, 'AI 接口配置已保存');
			}
			case 'updateSettings':
				await saveSettings(normalizeSettings(request.settings));
				return buildPanelResponse(true, '设置已保存');
			case 'runAiAgent': {
				const result = await runWithLoading(getAiTaskLoadingTitle(request.task), async () => runAiAgentTask(request.task, request.prompt));
				return buildPanelResponse(true, `${result.title} 已生成`);
			}
			case 'focusNet': {
				const targetNet = cleanString(request.netName);
				if (!targetNet) {
					return buildPanelResponse(false, '请输入要定位的网络名');
				}

				const context = await getCurrentContext();
				if (context !== 'pcb') {
					return buildPanelResponse(false, '请先切换到 PCB 页面，再执行网络定位');
				}

				const message = await runWithLoading(`正在定位网络 ${targetNet}...`, async () => selectPcbNetByName(targetNet, '已定位网络'));
				return buildPanelResponse(true, message);
			}
			case 'highlightDenseNet': {
				const targetNet = cleanString(request.netName);
				if (!targetNet) {
					return buildPanelResponse(false, '请选择要高亮的网络');
				}

				const context = await getCurrentContext();
				if (context !== 'pcb') {
					return buildPanelResponse(false, '请先切换到 PCB 页面，再执行网络高亮');
				}

				const message = await runWithLoading(`正在高亮网络 ${targetNet}...`, async () => selectPcbNetByName(targetNet));
				return buildPanelResponse(true, message);
			}
			case 'runAction': {
				const message = await runWithLoading(getPanelActionLoadingTitle(request.action), async () => runPanelAction(request.action));
				const ok = !message.startsWith('请先切换') && !message.startsWith('未支持');
				return buildPanelResponse(ok, message);
			}
		}
	} catch (error) {
		const message = `操作失败：${String(error)}`;
		eda.sys_Log.add(message);
		return buildPanelResponse(false, message);
	}
}

function ensurePanelRpcRegistered(): void {
	if (panelRpcRegistered) {
		return;
	}

	eda.sys_MessageBus.rpcServicePublic(PANEL_RPC_TOPIC, (request?: PanelRpcRequest) => handlePanelRpc(request));
	panelRpcRegistered = true;
}

export function activate(status?: 'onStartupFinished', arg?: string): void {
	void ensureSettings();
	void ensureAiConfig();
	ensurePanelRpcRegistered();
	if (status === 'onStartupFinished') {
		showToast(`${extensionConfig.displayName} 已就绪`);
	}
	if (arg) {
		eda.sys_Log.add(`activate arg: ${arg}`);
	}
}

export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		[
			`${extensionConfig.displayName} v${extensionConfig.version}`,
			'面向嘉立创 EDA 的原理图 / PCB 评分式体检插件。',
			'当前菜单仅保留“打开工作台”单入口，全部检查、报告、网络工具和 AI 助手统一收敛在 GUI 工作台中。',
			'AI 助手支持填写自定义模型接口，并基于最近报告生成总结、整改建议和复核清单。',
		].join('\n'),
		'关于 Design Copilot',
		'关闭',
	);
}

export function openControlPanel(): void {
	ensurePanelRpcRegistered();
	void runWithLoading('正在打开 Design Copilot 统一工作台...', async () => {
		try {
			await eda.sys_IFrame.closeIFrame(PANEL_IFRAME_ID);
		} catch (error) {
			eda.sys_Log.add(`Design Copilot closeIFrame skipped: ${String(error)}`);
		}

		try {
			await eda.sys_IFrame.openIFrame('/iframe/index.html', 1280, 840, PANEL_IFRAME_ID, {
				grayscaleMask: false,
				maximizeButton: true,
				minimizeButton: true,
			});
		} catch (error) {
			eda.sys_Log.add(`Design Copilot openIFrame failed: ${String(error)}`);
			eda.sys_Dialog.showInformationMessage(`统一工作台打开失败：${String(error)}`, 'Design Copilot 统一工作台', '关闭');
		}
	});
}

export function openSettings(): void {
	const current = getSettings();
	eda.sys_Dialog.showInputDialog(
		'请输入 JSON 配置。',
		'示例：{"topNetCount":5,"denseNetThreshold":8,"selectionPreviewLimit":6,"viaRiskThreshold":24}',
		'Design Copilot 设置',
		'text',
		JSON.stringify(current),
		{
			maxlength: 160,
			placeholder: JSON.stringify(DEFAULT_SETTINGS),
		},
		(value: string | undefined) => {
			const text = cleanString(value);
			if (!text) {
				return;
			}

			const settings = parseSettingsText(text);
			if (!settings) {
				return;
			}

			void saveSettings(settings).then(() => {
				showToast('Design Copilot 设置已保存');
			});
		},
	);
}

export function resetSettings(): void {
	void saveSettings(DEFAULT_SETTINGS).then(() => {
		showToast('Design Copilot 设置已恢复默认值');
	});
}
export function showLatestReport(): void {
	const report = getLatestReport();
	if (!report?.title || !Array.isArray(report.lines)) {
		eda.sys_Dialog.showInformationMessage('还没有生成过报告。先运行一次“快速体检”或“选区快照”。', 'Design Copilot', '关闭');
		return;
	}

	eda.sys_Dialog.showInformationMessage(formatReport(report), report.title, '关闭');
}

export function showReportHistory(): void {
	const history = getReportHistory();
	if (!history.length) {
		eda.sys_Dialog.showInformationMessage('还没有报告历史。先运行一次体检或 DRC。', 'Design Copilot 报告历史', '关闭');
		return;
	}

	const lines = history.map((item, index) => `${index + 1}. [${item.context}] ${item.title} / ${item.generatedAt}`);
	eda.sys_Dialog.showInformationMessage(lines.join('\n'), 'Design Copilot 报告历史', '关闭');
}

async function buildIntegratedSchematicReport(): Promise<Report> {
	const [baseReport, drcPassed] = await Promise.all([buildSchematicReport(), eda.sch_Drc.check(false, false)]);
	return {
		...baseReport,
		title: 'Design Copilot 原理图综合检查',
		lines: [...baseReport.lines, '', `DRC 摘要：${drcPassed ? '未发现阻断性错误' : '存在需要关注的 DRC 问题'}`],
	};
}

async function buildIntegratedPcbReport(): Promise<Report> {
	const [baseReport, ruleName, issues] = await Promise.all([
		buildPcbReport(),
		eda.pcb_Drc.getCurrentRuleConfigurationName(),
		eda.pcb_Drc.check(true, false, true),
	]);
	return {
		...baseReport,
		title: 'Design Copilot PCB 综合检查',
		lines: [
			...baseReport.lines,
			'',
			`DRC 规则：${ruleName ?? '未知规则'}`,
			`DRC 问题数：${issues.length}`,
			`DRC 摘要：${issues.length === 0 ? '当前 PCB DRC 通过' : '存在 DRC 问题，请打开 PCB DRC 面板查看明细'}`,
		],
	};
}

export function integratedCheckCurrentDocument(): void {
	void runWithLoading('正在执行一键综合检查...', async () => {
		const context = await getCurrentContext();
		if (context === 'sch') {
			await presentReport(await buildIntegratedSchematicReport());
			return;
		}
		if (context === 'pcb') {
			await presentReport(await buildIntegratedPcbReport());
			return;
		}

		eda.sys_Dialog.showInformationMessage('请先切换到原理图页或 PCB 页，再执行一键综合检查。', 'Design Copilot 综合检查', '关闭');
	});
}

export function snapshotCurrentSelection(): void {
	void runWithLoading('正在识别当前选区...', async () => {
		const context = await getCurrentContext();
		if (context === 'sch' || context === 'pcb') {
			await showSelectionReport(context);
			return;
		}

		eda.sys_Dialog.showInformationMessage('请先切换到原理图页或 PCB 页，再执行选区快照。', 'Design Copilot 当前选区', '关闭');
	});
}
export function auditCurrentDocument(): void {
	void runWithLoading('正在识别当前文档...', async () => {
		const context = await getCurrentContext();
		if (context === 'sch') {
			await presentReport(await buildSchematicReport());
			return;
		}
		if (context === 'pcb') {
			await presentReport(await buildPcbReport());
			return;
		}

		const documentInfo = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		const report: Report = {
			context: 'general',
			generatedAt: createTimestamp(),
			title: 'Design Copilot 当前文档状态',
			lines: [
				`当前焦点文档类型：${documentInfo?.documentType ?? '无活动文档'}`,
				'请先切换到原理图页或 PCB 页，再执行自动体检。',
				'在首页场景下，你仍然可以使用“查看最近报告”和“插件设置”。',
			],
		};
		await presentReport(report);
	});
}

export function auditSchematic(): void {
	void runWithLoading('正在分析当前原理图...', async () => {
		await presentReport(await buildSchematicReport());
	});
}

export function auditPcb(): void {
	void runWithLoading('正在分析当前 PCB...', async () => {
		await presentReport(await buildPcbReport());
	});
}

export function runSchematicDrc(): void {
	void runWithLoading('正在执行原理图 DRC...', async () => {
		await presentReport(await buildSchematicDrcReport());
	});
}

export function runPcbDrc(): void {
	void runWithLoading('正在执行 PCB DRC...', async () => {
		await presentReport(await buildPcbDrcReport());
	});
}
export function snapshotSchematicSelection(): void {
	void runWithLoading('正在整理原理图选区...', async () => {
		await showSelectionReport('sch');
	});
}

export function snapshotPcbSelection(): void {
	void runWithLoading('正在整理 PCB 选区...', async () => {
		await showSelectionReport('pcb');
	});
}

export function highlightMostConnectedNet(): void {
	void runWithLoading('正在查找最密网络...', async () => {
		const settings = await ensureSettings();
		const denseNets = await collectCurrentPcbDenseNetEntries(settings, settings.topNetCount, settings.denseNetThreshold);
		const fallbackNets = denseNets.length ? denseNets : await collectCurrentPcbDenseNetEntries(settings, 1);
		const targetNet = denseNets[0] ?? fallbackNets[0];

		if (!targetNet) {
			eda.sys_Dialog.showInformationMessage('当前 PCB 中没有可用于分析的网络。', 'Design Copilot 网络分析', '关闭');
			return;
		}

		await selectPcbNetByName(targetNet[0], '已高亮最密网络');
		showToast(`最密网络连接点：${targetNet[1]}`);
	});
}

export function chooseDenseNetToHighlight(): void {
	void runWithLoading('正在整理高密度网络列表...', async () => {
		const settings = await ensureSettings();
		const entries = await collectCurrentPcbDenseNetEntries(settings, settings.topNetCount, settings.denseNetThreshold);
		if (!entries.length) {
			eda.sys_Dialog.showInformationMessage('没有达到当前阈值的高密度网络。', 'Design Copilot 网络分析', '关闭');
			return;
		}

		eda.sys_Dialog.showSelectDialog(
			entries.map(([net, count]) => ({ value: net, displayContent: `${net}（连接点 ${count}）` })),
			'请选择要高亮的网络。',
			'列表基于当前设置中的 denseNetThreshold。',
			'Design Copilot 选择网络',
			entries[0][0],
			false,
			(value: string) => {
				const targetNet = cleanString(value);
				if (!targetNet) {
					return;
				}

				void runWithLoading(`正在高亮网络 ${targetNet}...`, async () => {
					await selectPcbNetByName(targetNet);
				});
			},
		);
	});
}
export function focusNetByName(): void {
	eda.sys_Dialog.showInputDialog(
		'请输入要聚焦的网络名（区分大小写）。',
		'例如：GND、VBUS、3V3、USB_D+。',
		'Design Copilot 网络定位',
		'text',
		'',
		{
			maxlength: 80,
			placeholder: 'GND',
		},
		(value: string | undefined) => {
			const targetNet = cleanString(value);
			if (!targetNet) {
				return;
			}

			void runWithLoading(`正在定位网络 ${targetNet}...`, async () => {
				await selectPcbNetByName(targetNet, '已定位网络');
			});
		},
	);
}
export function saveCurrentDesign(): void {
	void runWithLoading('正在保存当前设计...', async () => {
		const currentDocument = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		const documentType = currentDocument?.documentType;
		const saved =
			documentType === 1 ? await eda.sch_Document.save() : documentType === 3 ? await eda.pcb_Document.save() : await eda.pnl_Document.save();
		showToast(saved ? '当前设计已保存' : '保存失败，请检查文档状态');
	});
}
