import { useState } from "react";
import { useApp } from "@/store/app-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Star, Edit3, Trash2, FileText, Check, X, Sparkles } from "lucide-react";
import type { ReportTemplate } from "@/types";

export function TemplatesPage() {
  const { templates, setDefaultTemplate, updateTemplate, deleteTemplate, addTemplate } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReportTemplate | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newTemplate, setNewTemplate] = useState<{
    name: string;
    description: string;
    content: string;
  }>({
    name: "",
    description: "",
    content: "",
  });

  const startEdit = (t: ReportTemplate) => {
    setEditingId(t.id);
    setDraft({ ...t });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = () => {
    if (!draft) return;
    updateTemplate(draft.id, {
      name: draft.name,
      description: draft.description,
      content: draft.content,
    });
    cancelEdit();
  };

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            <FileText className="h-4 w-4 text-blue-400" />
            Quản lý mẫu báo cáo
          </h1>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Tạo và chỉnh sửa template sinh báo cáo. Mẫu mặc định sẽ được dùng khi viết báo cáo mới.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreatingNew(true)}>
          <Plus className="h-3.5 w-3.5" />
          Tạo mẫu mới
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {templates.map((t) => (
          <Card
            key={t.id}
            className={t.isDefault ? "border-blue-500/30 bg-blue-500/5" : undefined}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    {t.name}
                    {t.isDefault && (
                      <Badge variant="blue">
                        <Star className="h-3 w-3 fill-current" />
                        Mặc định
                      </Badge>
                    )}
                    {t.kind === "prompt" && (
                      <Badge variant="warning" className="gap-1">
                        <Sparkles className="h-3 w-3" />
                        Prompt LLM
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1 text-[11px]">
                    {t.description}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!t.isDefault && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="Đặt làm mặc định"
                      onClick={() => setDefaultTemplate(t.id)}
                    >
                      <Star className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => startEdit(t)}
                    title="Chỉnh sửa"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </Button>
                  {templates.length > 1 && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => deleteTemplate(t.id)}
                      title="Xóa"
                      className="hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {editingId === t.id && draft ? (
                <div className="flex flex-col gap-2">
                  <div>
                    <Label className="text-[11px]">Tên mẫu</Label>
                    <Input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      className="h-8 text-[12px]"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Mô tả</Label>
                    <Input
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      className="h-8 text-[12px]"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Nội dung template</Label>
                    <Textarea
                      value={draft.content}
                      onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                      className="min-h-[200px] font-mono text-[11px]"
                    />
                    <p className="mt-1 text-[10px] text-slate-500">
                      Placeholder: {"{player1Full}"}, {"{score}"}, {"{setNarrative}"}, {"{tournament}"}, v.v.
                    </p>
                  </div>
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="ghost" onClick={cancelEdit}>
                      <X className="h-3.5 w-3.5" />
                      Hủy
                    </Button>
                    <Button size="sm" onClick={saveEdit}>
                      <Check className="h-3.5 w-3.5" />
                      Lưu
                    </Button>
                  </div>
                </div>
              ) : (
                <pre className="max-h-44 overflow-hidden rounded-md border border-slate-800 bg-slate-900/60 p-2 text-[10px] leading-relaxed text-slate-400 [mask-image:linear-gradient(to_bottom,black_50%,transparent)]">
                  {t.content.slice(0, 400)}…
                </pre>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* New template dialog */}
      <Dialog open={creatingNew} onOpenChange={setCreatingNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tạo mẫu báo cáo mới</DialogTitle>
            <DialogDescription>
              Dùng các placeholder như {"{player1Full}"}, {"{score}"}, {"{tournament}"} — hệ thống sẽ tự thay thế khi sinh báo cáo.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div>
              <Label>Tên mẫu</Label>
              <Input
                value={newTemplate.name}
                onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                placeholder="VD: Tennis Recap (Bóng đá)"
              />
            </div>
            <div>
              <Label>Mô tả ngắn</Label>
              <Input
                value={newTemplate.description}
                onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                placeholder="Mô tả văn phong/độ dài"
              />
            </div>
            <div>
              <Label>Nội dung template</Label>
              <Textarea
                value={newTemplate.content}
                onChange={(e) => setNewTemplate({ ...newTemplate, content: e.target.value })}
                placeholder="**{tournament} – {round}**&#10;&#10;Nội dung báo cáo..."
                className="min-h-[180px] font-mono text-[12px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreatingNew(false)}>
              Hủy
            </Button>
            <Button
              onClick={() => {
                if (!newTemplate.name || !newTemplate.content) return;
                addTemplate({
                  name: newTemplate.name,
                  description: newTemplate.description,
                  content: newTemplate.content,
                  isDefault: false,
                });
                setNewTemplate({ name: "", description: "", content: "" });
                setCreatingNew(false);
              }}
            >
              Tạo mẫu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
