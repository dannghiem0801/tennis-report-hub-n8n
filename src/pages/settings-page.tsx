import { useState } from "react";
import { useApp } from "@/store/app-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Key, Bell, Clock, Globe, Database, Check, Loader2, ShieldAlert, Trash2, HardDrive, Brain, Sparkles, Save, SlidersHorizontal, Search } from "lucide-react";
import { toast } from "sonner";
import { formatDateVi, timeAgo } from "@/lib/utils";
import { callLLM, LLMError, DEFAULT_LLM as FALLBACK_LLM } from "@/api/llm";
import type { LLMConfig, LLMProvider } from "@/types";
import { env } from "@/lib/env";

type TestStatus = "idle" | "testing" | "ok" | "error";

const DEFAULT_LLM: LLMConfig = FALLBACK_LLM;

const OPENAI_PRESETS: { label: string; url: string; defaultModel: string }[] = [
  { label: "OpenAI", url: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  { label: "Groq", url: "https://api.groq.com/openai/v1", defaultModel: "llama-3.1-70b-versatile" },
  { label: "Together.ai", url: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3-70b-chat-hf" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1", defaultModel: "anthropic/claude-3.5-sonnet" },
  { label: "Ollama (local)", url: "http://localhost:11434/v1", defaultModel: "llama3.1" },
  { label: "LM Studio (local)", url: "http://localhost:1234/v1", defaultModel: "local-model" },
];

const ANTHROPIC_PRESETS: { label: string; model: string }[] = [
  { label: "Claude 3.5 Sonnet (latest)", model: "claude-3-5-sonnet-latest" },
  { label: "Claude 3.5 Haiku (latest)", model: "claude-3-5-haiku-latest" },
  { label: "Claude 3 Opus", model: "claude-3-opus-20240229" },
  { label: "Claude 3.5 Sonnet (2024-10-22)", model: "claude-3-5-sonnet-20241022" },
];

export function SettingsPage() {
  const { settings, updateSettings, lastFetchedAt, reports, watchlist, testApiConnection, cacheSize, clearApiCacheAndRefresh, clearAllReports } = useApp();
  const [saved, setSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [llmTestStatus, setLlmTestStatus] = useState<TestStatus>("idle");
  const [llmTestError, setLlmTestError] = useState<string | null>(null);
  const [llmTestInfo, setLlmTestInfo] = useState<string | null>(null);
  const [isSavingToEnv, setIsSavingToEnv] = useState(false);

  const llm: LLMConfig = settings.llm ?? DEFAULT_LLM;

  const updateLlm = (patch: Partial<LLMConfig>) => {
    updateSettings({ llm: { ...llm, ...patch } });
    if (llmTestStatus !== "idle") {
      setLlmTestStatus("idle");
      setLlmTestError(null);
      setLlmTestInfo(null);
    }
  };

  /**
   * Persist every env-overridable field to `.env.local` via the
   * Vite dev middleware (`POST /__save-env`). The middleware
   * updates the file in place; Vite's file watcher then triggers
   * a full page reload, after which the new env values pre-fill
   * localStorage and the UI re-renders with the updated inputs.
   *
   * Only sends keys that are currently non-empty so we don't
   * accidentally clobber a previously-saved value when the user
   * just hasn't filled this particular field in yet. Explicit
   * "clear" is not supported in this bulk handler — to remove a
   * key from `.env.local`, edit the file directly.
   */
  const handleSaveToEnv = async () => {
    setIsSavingToEnv(true);
    const updates: Record<string, string> = {};
    if (llm.enabled !== undefined) updates.VITE_LLM_ENABLED = String(llm.enabled);
    if (llm.provider) updates.VITE_LLM_PROVIDER = llm.provider;
    if (llm.baseUrl) updates.VITE_LLM_BASE_URL = llm.baseUrl;
    if (llm.apiKey) updates.VITE_LLM_API_KEY = llm.apiKey;
    if (llm.model) updates.VITE_LLM_MODEL = llm.model;
    if (llm.temperature !== undefined) updates.VITE_LLM_TEMPERATURE = String(llm.temperature);
    if (llm.maxTokens !== undefined) updates.VITE_LLM_MAX_TOKENS = String(llm.maxTokens);
    if (llm.enableThinking !== undefined) updates.VITE_LLM_ENABLE_THINKING = String(llm.enableThinking);
    if (llm.enableWebSearch !== undefined) updates.VITE_LLM_ENABLE_WEB_SEARCH = String(llm.enableWebSearch);
    if (llm.searchProvider) updates.VITE_LLM_SEARCH_PROVIDER = llm.searchProvider;
    if (llm.searchApiKey) updates.VITE_LLM_SEARCH_API_KEY = llm.searchApiKey;

    if (Object.keys(updates).length === 0) {
      toast.error("Chưa có giá trị nào để lưu. Hãy điền ít nhất 1 key trước.");
      setIsSavingToEnv(false);
      return;
    }

    try {
      const res = await fetch("/__save-env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(`Lỗi: ${data?.error ?? `HTTP ${res.status}`}`);
        return;
      }
      toast.success(
        `Đã lưu ${data.wrote.length} key vào .env.local. Vite sẽ tự reload trong ~1s.`,
        { duration: 5000 }
      );
    } catch (e) {
      toast.error(`Không gọi được dev server: ${(e as Error).message}`);
    } finally {
      setIsSavingToEnv(false);
    }
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleTest = async () => {
    setTestStatus("testing");
    setTestError(null);
    const err = await testApiConnection();
    if (err) {
      setTestStatus("error");
      setTestError(err);
    } else {
      setTestStatus("ok");
      // Auto-clear success state after 4s
      setTimeout(() => setTestStatus((s) => (s === "ok" ? "idle" : s)), 4000);
    }
  };

  const handleLlmTest = async () => {
    setLlmTestStatus("testing");
    setLlmTestError(null);
    setLlmTestInfo(null);
    try {
      const result = await callLLM({
        prompt:
          'Bạn là trợ lý tennis. Trả lời DUY NHẤT một câu ngắn bằng tiếng Việt: "Kết nối LLM thành công."',
        config: llm,
      });
      setLlmTestStatus("ok");
      setLlmTestInfo(result.model ? `OK · model: ${result.model}` : "OK");
      setTimeout(() => setLlmTestStatus((s) => (s === "ok" ? "idle" : s)), 6000);
    } catch (e) {
      setLlmTestStatus("error");
      setLlmTestError(e instanceof LLMError ? e.message : e instanceof Error ? e.message : "Lỗi không xác định");
    }
  };

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            <span className="flex h-4 w-4 items-center justify-center">⚙️</span>
            Cài đặt
          </h1>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Cấu hình API, polling, múi giờ và các tùy chọn ứng dụng.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={handleSaveToEnv}
            disabled={isSavingToEnv}
            className="h-7 text-[11px]"
            title="Ghi tất cả API key hiện tại vào file .env.local. Vite sẽ tự reload sau khi lưu."
          >
            {isSavingToEnv ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Đang lưu…
              </>
            ) : (
              <>
                <Save className="h-3 w-3" />
                Lưu vào .env.local
              </>
            )}
          </Button>
          <span className="text-[9px] text-slate-500">
            Dev only — ghi qua Vite middleware
          </span>
        </div>
      </div>

      {/* ===== API Section — third-party API credentials & endpoints ===== */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Key className="h-3.5 w-3.5 text-blue-400" />
          <h2 className="text-sm font-semibold text-slate-100">API</h2>
          <span className="text-[11px] text-slate-500">— Khóa &amp; endpoint dịch vụ bên thứ 3 (Tennis, LLM, Search)</span>
          <div className="h-px flex-1 bg-slate-800" />
        </div>
        <Tabs defaultValue="tennis">
          <TabsList>
            <TabsTrigger value="tennis">
              <Key className="mr-1.5 h-3 w-3" />
              Tennis API
            </TabsTrigger>
            <TabsTrigger value="llm">
              <Brain className="mr-1.5 h-3 w-3" />
              LLM
            </TabsTrigger>
            <TabsTrigger value="search">
              <Search className="mr-1.5 h-3 w-3" />
              Search
            </TabsTrigger>
          </TabsList>
          <TabsContent value="tennis">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Key className="h-3.5 w-3.5 text-blue-400" />
                  Tennis API (máy chủ)
                </CardTitle>
                <CardDescription className="text-[11px]">
                  RapidAPI được cấu hình trên máy chủ. Trình duyệt không lưu hoặc gửi API key.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                    <ShieldAlert className="h-3 w-3 text-blue-400" />
                    <span>Biến môi trường cần có: <code>RAPID_API_KEY</code></span>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleTest}
                      disabled={testStatus === "testing"}
                      className="h-7 text-[11px]"
                    >
                      {testStatus === "testing" ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Đang test…
                        </>
                      ) : (
                        "Test connection"
                      )}
                    </Button>
                    {testStatus === "ok" && (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                        <Check className="h-3 w-3" /> Kết nối OK
                      </span>
                    )}
                  </div>
                </div>
                {testStatus === "error" && testError && (
                  <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                    {testError}
                  </div>
                )}
                <div className="flex items-start gap-1.5 rounded border border-slate-800 bg-slate-900/40 px-2 py-1.5 text-[10px] text-slate-400">
                  <ShieldAlert className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-400" />
                  <span>
                    Đặt <code>RAPID_API_KEY</code> trong biến môi trường của Vercel (hoặc
                    <code> .env.local</code> khi chạy local). Key chỉ được đọc bởi proxy máy chủ.
                  </span>
                </div>
                {/* Cache info — helps user see why a refresh is instant */}
                <div className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900/40 px-2 py-1.5 text-[10px] text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="h-3 w-3 text-slate-500" />
                    Cache: <span className="font-mono text-slate-200">{cacheSize}</span> mục
                    <span className="text-slate-500">·</span>
                    <span className="text-slate-500">fixtures 30 phút, tournament 24 giờ</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm("Xóa cache API? Lần refresh tiếp theo sẽ gọi lại FlashScore API.")) {
                        clearApiCacheAndRefresh();
                      }
                    }}
                    disabled={cacheSize === 0}
                    className="h-6 px-1.5 text-[10px] text-slate-300 hover:text-red-300"
                    title="Xóa cache và refresh"
                  >
                    <Trash2 className="h-3 w-3" />
                    Xóa cache
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="llm">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Brain className="h-3.5 w-3.5 text-blue-400" />
                  LLM — tự tạo báo cáo
                  {llm.enabled && llm.apiKey && llm.model ? (
                    <Badge variant="success" className="ml-1 gap-1">
                      <Sparkles className="h-3 w-3" />
                      Auto
                    </Badge>
                  ) : (
                    <Badge variant="slate" className="ml-1">
                      Tắt
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-[11px]">
                  Khi bật, app tự gọi LLM để viết báo cáo tiếng Việt khi trận kết thúc — không cần copy-paste prompt
                  thủ công. Mặc định dùng <strong>Anthropic Messages API</strong> (<code className="text-[10px]">/v1/messages</code>,
                  hỗ trợ <code className="text-[10px]">thinking</code> blocks cho MiniMax-M3). Có thể chuyển sang
                  OpenAI-compatible (<code className="text-[10px]">/chat/completions</code>) cho OpenAI/Groq/Together/Ollama.
                  Trỏ Base URL tới proxy Anthropic-compatible của bạn (vd. <code className="text-[10px]">https://api.minimax.io/anthropic</code>).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={llm.enabled}
                    onChange={(e) => updateLlm({ enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-200">Bật auto-generate báo cáo qua LLM</span>
                </label>
  
                {/* Provider picker */}
                <div>
                  <Label className="text-[11px]">LLM Provider</Label>
                  <Select
                    value={llm.provider ?? "anthropic"}
                    onValueChange={(v) => {
                      const provider = v as LLMProvider;
                      if (provider === "anthropic") {
                        updateLlm({
                          provider,
                          // Don't prefill baseUrl/model — let the user enter their
                          // own Anthropic-compatible proxy + model. Reuse the
                          // existing values if already set.
                          baseUrl: llm.baseUrl,
                          model: llm.model,
                          enableThinking: llm.enableThinking ?? true,
                          enableWebSearch: llm.enableWebSearch ?? true,
                        });
                      } else {
                        updateLlm({
                          provider,
                          baseUrl: llm.baseUrl,
                          model: llm.model,
                          // `enableThinking` and `enableWebSearch` only apply
                          // to Anthropic, but keep the fields for consistency
                          // (no-op for OpenAI).
                          enableThinking: false,
                          enableWebSearch: false,
                        });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="anthropic">
                        Anthropic Messages-compatible <span className="text-slate-500">— /v1/messages, hỗ trợ thinking</span>
                      </SelectItem>
                      <SelectItem value="openai-compatible">
                        OpenAI-compatible <span className="text-slate-500">— /chat/completions, OpenAI/Groq/Together/Ollama</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
  
                {/* Anthropic-only: thinking + web_search toggles (independent) */}
                {llm.provider === "anthropic" && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={llm.enableThinking ?? true}
                        onChange={(e) => updateLlm({ enableThinking: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-200">
                        Bật thinking blocks (adaptive){" "}
                        <span className="text-[11px] text-slate-500">
                          — model suy nghĩ nội bộ trước khi viết, tránh bị kẹt
                          ở tool-mode (khuyến nghị cho MiniMax-M3)
                        </span>
                      </span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={llm.enableWebSearch ?? true}
                        onChange={(e) => updateLlm({ enableWebSearch: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-200">
                        Bật web_search (custom tool){" "}
                        <span className="text-[11px] text-slate-500">
                          — model gọi <code className="text-[10px]">web_search(query)</code> để
                          verify tỷ số từ nguồn web thứ 2
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                {/* OpenAI-compatible-only: base URL */}
                {llm.provider === "openai-compatible" && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <Label className="text-[11px]">Provider preset</Label>
                      <Select
                        value={(() => {
                          const match = OPENAI_PRESETS.find((p) => p.url === llm.baseUrl);
                          return match ? match.label : "custom";
                        })()}
                        onValueChange={(v) => {
                          if (v === "custom") return;
                          const preset = OPENAI_PRESETS.find((p) => p.label === v);
                          if (preset) {
                            updateLlm({ baseUrl: preset.url, model: llm.model || preset.defaultModel });
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPENAI_PRESETS.map((p) => (
                            <SelectItem key={p.label} value={p.label}>
                              {p.label} <span className="text-slate-500">— {p.url}</span>
                            </SelectItem>
                          ))}
                          <SelectItem value="custom">Custom (nhập tay)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px]">Base URL</Label>
                      <Input
                        type="text"
                        value={llm.baseUrl ?? ""}
                        onChange={(e) => updateLlm({ baseUrl: e.target.value })}
                        placeholder="https://api.openai.com/v1"
                        className="font-mono text-[12px]"
                      />
                    </div>
                  </div>
                )}
  
                {/* Anthropic: baseUrl + model presets */}
                {llm.provider === "anthropic" && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <Label className="text-[11px]">
                        Base URL
                        <span className="ml-1 text-[10px] text-slate-500">
                          (Anthropic-compatible proxy)
                        </span>
                      </Label>
                      <Input
                        type="text"
                        value={llm.baseUrl ?? ""}
                        onChange={(e) => updateLlm({ baseUrl: e.target.value })}
                        placeholder="https://api.minimax.io/anthropic"
                        className="font-mono text-[12px]"
                      />
                    </div>
                    <div>
                      <Label className="text-[11px]">Model preset (tùy chọn)</Label>
                      <Select
                        value={(() => {
                          const match = ANTHROPIC_PRESETS.find((p) => p.model === llm.model);
                          return match ? match.label : "custom";
                        })()}
                        onValueChange={(v) => {
                          if (v === "custom") return;
                          const preset = ANTHROPIC_PRESETS.find((p) => p.label === v);
                          if (preset) updateLlm({ model: preset.model });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ANTHROPIC_PRESETS.map((p) => (
                            <SelectItem key={p.label} value={p.label}>
                              {p.label} <span className="text-slate-500">— {p.model}</span>
                            </SelectItem>
                          ))}
                          <SelectItem value="custom">Custom (nhập tay)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
  
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px]">
                      {llm.provider === "anthropic" ? "Anthropic API Key" : "API Key"}
                    </Label>
                    {env.llm.apiKey() && (
                      <Badge
                        variant="outline"
                        className="border-blue-500/30 bg-blue-500/10 text-[9px] text-blue-300"
                        title="Giá trị này đang được load từ VITE_LLM_API_KEY trong .env.local. Khi reload, giá trị từ .env sẽ ghi đè. Để UI override bền vững, hãy xoá dòng VITE_LLM_API_KEY trong .env.local."
                      >
                        Từ .env
                      </Badge>
                    )}
                  </div>
                  <Input
                    type="password"
                    value={llm.apiKey}
                    onChange={(e) => updateLlm({ apiKey: e.target.value })}
                    placeholder={llm.provider === "anthropic" ? "sk-ant-..." : "sk-..."}
                    className="font-mono text-[12px]"
                  />
                </div>
  
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="sm:col-span-1">
                    <Label className="text-[11px]">Model</Label>
                    <Input
                      type="text"
                      value={llm.model}
                      onChange={(e) => updateLlm({ model: e.target.value })}
                      placeholder={llm.provider === "anthropic" ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"}
                      className="font-mono text-[12px]"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Temperature</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={llm.temperature ?? 0.7}
                      onChange={(e) => updateLlm({ temperature: Number(e.target.value) })}
                      className="font-mono text-[12px]"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">
                      Max tokens
                      <span className="ml-1 text-[10px] text-slate-500">
                        (mặc định 200000)
                      </span>
                    </Label>
                    <Input
                      type="number"
                      step="1000"
                      min="500"
                      max="1000000"
                      value={llm.maxTokens ?? 200000}
                      onChange={(e) => updateLlm({ maxTokens: Number(e.target.value) })}
                      className="font-mono text-[12px]"
                    />
                  </div>
                </div>
  
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleLlmTest}
                    disabled={
                      !llm.baseUrl || !llm.apiKey || !llm.model || llmTestStatus === "testing"
                    }
                    className="h-7 text-[11px]"
                  >
                    {llmTestStatus === "testing" ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Đang test…
                      </>
                    ) : (
                      "Test LLM"
                    )}
                  </Button>
                  {llmTestStatus === "ok" && llmTestInfo && (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                      <Check className="h-3 w-3" /> {llmTestInfo}
                    </span>
                  )}
                </div>
  
                {llmTestStatus === "error" && llmTestError && (
                  <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                    {llmTestError}
                  </div>
                )}
  
                <div className="flex items-start gap-1.5 rounded border border-slate-800 bg-slate-900/40 px-2 py-1.5 text-[10px] text-slate-400">
                  <ShieldAlert className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-400" />
                  <span>
                    LLM key lưu local trong trình duyệt và gửi trực tiếp tới baseUrl. Cho production, route qua
                    server proxy để giữ key bí mật. Nếu LLM call fail, app tự fallback về prompt + context để bạn
                    copy-paste thủ công.
                  </span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="search">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Search className="h-3.5 w-3.5 text-blue-400" />
                  Web Search Backend
                </CardTitle>
                <CardDescription className="text-[11px]">
                  Search backend dùng cho LLM's <code className="text-[10px]">web_search</code> tool — verify tỷ số từ nguồn web thứ 2.
                  Chỉ có hiệu lực khi LLM provider = Anthropic và <code className="text-[10px]">web_search</code> toggle bật.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select
                  value={llm.searchProvider ?? "firecrawl"}
                  onValueChange={(v) => {
                    // Clear key when switching away from a key-requiring provider
                    const newProvider = v as typeof llm.searchProvider;
                    const needsKey = newProvider === "firecrawl" || newProvider === "serpapi" || newProvider === "brave";
                    updateLlm({
                      searchProvider: newProvider,
                      // Keep the key if switching between key-requiring providers; clear only for duckduckgo
                      searchApiKey: needsKey ? llm.searchApiKey : "",
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="firecrawl">
                      Firecrawl <span className="text-slate-500">— recommended, free 500 credits, full markdown</span>
                    </SelectItem>
                    <SelectItem value="duckduckgo">
                      DuckDuckGo <span className="text-slate-500">— free, dev-only, thường bị block</span>
                    </SelectItem>
                    <SelectItem value="serpapi">
                      SerpAPI <span className="text-slate-500">— free 100/tháng, snippets only</span>
                    </SelectItem>
                    <SelectItem value="brave">
                      Brave Search <span className="text-slate-500">— free 2000/tháng, snippets only</span>
                    </SelectItem>
                  </SelectContent>
                </Select>

                {/* API key input — only when provider needs one */}
                {(llm.searchProvider === "firecrawl" ||
                  llm.searchProvider === "serpapi" ||
                  llm.searchProvider === "brave") && (
                  <div>
                    <Label className="text-[11px] text-slate-400">
                      {llm.searchProvider === "firecrawl"
                        ? "Firecrawl API key (fc-...)"
                        : llm.searchProvider === "serpapi"
                          ? "SerpAPI key"
                          : "Brave Search API key"}
                    </Label>
                    <Input
                      type="password"
                      value={llm.searchApiKey ?? ""}
                      onChange={(e) => updateLlm({ searchApiKey: e.target.value })}
                      placeholder={
                        llm.searchProvider === "firecrawl"
                          ? "fc-..."
                          : llm.searchProvider === "serpapi"
                            ? "serpapi api_key"
                            : "BSA..."
                      }
                      className="font-mono text-[12px]"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      {llm.searchProvider === "firecrawl" && (
                        <>
                          Đăng ký free: <a href="https://www.firecrawl.dev/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">firecrawl.dev</a> — 500 credits (~250 searches/tháng).
                        </>
                      )}
                      {llm.searchProvider === "serpapi" && (
                        <>
                          Đăng ký: <a href="https://serpapi.com/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">serpapi.com</a> — 100 searches/tháng free.
                        </>
                      )}
                      {llm.searchProvider === "brave" && (
                        <>
                          Đăng ký: <a href="https://brave.com/search/api/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">brave.com/search/api</a> — 2000 queries/tháng free.
                        </>
                      )}
                    </p>
                  </div>
                )}

                {llm.searchProvider === "duckduckgo" && (
                  <p className="text-[10px] text-amber-400/80">
                    ⚠ DuckDuckGo scrape thường bị block từ IP không phải browser. Nên dùng Firecrawl/SerpAPI/Brave thay thế để có verify thật.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>

      {/* ===== Setting Section — app preferences, polling, timezone, notifications, data ===== */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5 text-blue-400" />
          <h2 className="text-sm font-semibold text-slate-100">Setting</h2>
          <span className="text-[11px] text-slate-500">— Tuỳ chọn ứng dụng, polling, múi giờ, thông báo &amp; dữ liệu local</span>
          <div className="h-px flex-1 bg-slate-800" />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* Polling */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Clock className="h-3.5 w-3.5 text-blue-400" />
                Polling
              </CardTitle>
              <CardDescription className="text-[11px]">
                Tần suất tự động cập nhật điểm số và detect trận hoàn thành.
                Chọn "Không tự động" nếu muốn refresh thủ công (tiết kiệm quota).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <Label className="text-[11px]">Khoảng thời gian (phút)</Label>
                <Select
                  value={String(settings.pollingIntervalMinutes)}
                  onValueChange={(v) => updateSettings({ pollingIntervalMinutes: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">🔕 Không tự động (No Poll) — mặc định</SelectItem>
                    <SelectItem value="1">Mỗi 1 phút</SelectItem>
                    <SelectItem value="5">Mỗi 5 phút</SelectItem>
                    <SelectItem value="10">Mỗi 10 phút</SelectItem>
                    <SelectItem value="15">Mỗi 15 phút</SelectItem>
                    <SelectItem value="30">Mỗi 30 phút</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-900/40 p-2 text-[11px]">
                <div className="text-slate-500">Trạng thái</div>
                <div className="mt-0.5 text-slate-300">
                  {settings.pollingIntervalMinutes === 0
                    ? "🔕 Auto-refresh TẮT — chỉ refresh thủ công (nút Refresh trên Dashboard). Cache 30 phút vẫn áp dụng cho mỗi lần bấm Refresh."
                    : lastFetchedAt
                      ? `Cập nhật lần cuối: ${timeAgo(lastFetchedAt)}`
                      : "Chưa cập nhật"}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Timezone — fixed, no user choice (single-market VN product) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Globe className="h-3.5 w-3.5 text-blue-400" />
                Múi giờ
              </CardTitle>
              <CardDescription className="text-[11px]">
                Cố định cho toàn app (dùng cho cả hiển thị lẫn gọi API).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200">
                <span className="font-mono">Asia/Ho_Chi_Minh</span>
                <span className="text-[11px] text-slate-500">·</span>
                <span className="text-[11px] text-slate-500">UTC+7 (Việt Nam)</span>
              </div>
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Bell className="h-3.5 w-3.5 text-blue-400" />
                Thông báo
              </CardTitle>
              <CardDescription className="text-[11px]">
                Nhận thông báo khi có báo cáo mới được sinh.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.notificationsEnabled}
                  onChange={(e) => updateSettings({ notificationsEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-200">
                  Bật thông báo khi báo cáo mới sẵn sàng
                </span>
              </label>
            </CardContent>
          </Card>

          {/* Storage stats */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Database className="h-3.5 w-3.5 text-blue-400" />
                Dữ liệu lưu trữ (Local)
              </CardTitle>
              <CardDescription className="text-[11px]">
                Trong v1, watchlist và báo cáo được lưu trên trình duyệt (localStorage). Khi deploy production sẽ dùng Supabase.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Trận theo dõi" value={watchlist.length} />
                <Stat label="Báo cáo đã viết" value={reports.length} />
                <Stat
                  label="Trạng thái"
                  value="LocalStorage"
                  valueClass="text-emerald-300"
                />
                <Stat
                  label="Lần cập nhật cuối"
                  value={lastFetchedAt ? formatDateVi(lastFetchedAt) : "—"}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Xóa toàn bộ ${reports.length} báo cáo? Watchlist sẽ được giữ nguyên — các trận đã hoàn thành trong watchlist sẽ tự tạo lại báo cáo khi có thay đổi trạng thái. Hành động này không thể hoàn tác.`
                      )
                    ) {
                      clearAllReports();
                    }
                  }}
                  disabled={reports.length === 0}
                  className="text-amber-300 hover:text-amber-200 disabled:opacity-50"
                  title={reports.length === 0 ? "Không có báo cáo để xóa" : `Xóa ${reports.length} báo cáo`}
                >
                  <Trash2 className="h-3 w-3" />
                  Clear Báo cáo ({reports.length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (window.confirm("Xóa toàn bộ dữ liệu watchlist và báo cáo? Hành động này không thể hoàn tác.")) {
                      localStorage.clear();
                      window.location.reload();
                    }
                  }}
                  className="text-red-300 hover:text-red-200"
                >
                  Xóa tất cả dữ liệu
                </Button>
                <Badge variant="slate">v1.0.0</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        {saved && <span className="text-[11px] text-emerald-400">Đã lưu cài đặt</span>}
        <Button onClick={handleSave}>
          <Check className="h-3.5 w-3.5" />
          Lưu cài đặt
        </Button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string | number;
  valueClass?: string;
}) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${valueClass || "text-slate-100"}`}>
        {value}
      </div>
    </div>
  );
}
