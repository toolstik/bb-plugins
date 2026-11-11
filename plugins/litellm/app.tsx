import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { credentialRpcContract } from "./credential-contract.js";
import { Button, Input } from "./components/credential-controls.js";

export function CredentialSettings() {
  const rpc = useRpc<typeof credentialRpcContract>();
  const [hosts, setHosts] = useState<{ id: string; name: string; connected: boolean }[]>([]);
  const [hostId, setHostId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [info, setInfo] = useState<{ path: string; configured: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    rpc.call("credentialTargets", {}).then(result => { if (!active) return; setHosts(result.hosts); setHostId(result.hosts.find(item => item.connected)?.id ?? ""); }, () => { if (active) setError("Не удалось загрузить список машин."); });
    return () => { active = false; };
  }, [rpc]);
  useEffect(() => {
    setInfo(null); setApiKey(""); setMessage(""); setError("");
    if (!hostId) return;
    let active = true;
    rpc.call("credentialStatus", { hostId }).then(value => { if (active) setInfo(value); }, () => { if (active) setError("Не удалось проверить файл ключа на выбранной машине."); });
    return () => { active = false; };
  }, [hostId, rpc]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!hostId || !apiKey.trim() || busy) return;
    setBusy(true); setError(""); setMessage("");
    const key = apiKey.trim(); setApiKey("");
    try {
      const result = await rpc.call("saveCredential", { hostId, apiKey: key });
      setInfo(result); setMessage("Ключ сохранен. Новые запросы будут использовать его автоматически.");
    } catch { setError("Не удалось сохранить ключ. Проверьте подключение машины и путь к env-файлу в настройках. Прежний ключ сохранен."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-3" data-bb-plugin="litellm" data-bb-plugin-root="litellm">
    <p className="text-sm text-muted-foreground">Введите или замените персональный ключ LiteLLM. Он будет сохранен в приватный env-файл на выбранной машине.</p>
    <label className="block space-y-1 text-sm">Машина
      <select aria-label="Машина" value={hostId} disabled={busy} onChange={event => setHostId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3">
        <option value="" disabled>Выберите машину</option>
        {hosts.map(item => <option key={item.id} value={item.id} disabled={!item.connected}>{item.name}{item.connected ? "" : " (не подключена)"}</option>)}
      </select>
    </label>
    {info && <p className="break-all text-xs text-muted-foreground">{info.configured ? "Ключ настроен" : "Ключ не настроен"}: {info.path}</p>}
    <label className="block space-y-1 text-sm">API-ключ
      <Input aria-label="API-ключ" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy || !hostId} placeholder={info?.configured ? "Введите новый ключ для замены" : "Введите персональный virtual key"} />
    </label>
    <Button type="submit" disabled={busy || !hostId || !apiKey.trim()}>{busy ? "Сохранение..." : "Сохранить ключ"}</Button>
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
function BehaviorSettings() {
  return <div className="space-y-2 text-sm" data-bb-plugin="litellm" data-bb-plugin-root="litellm">
    <p>LiteLLM / Claude Code использует настройки плагина Claude Code. LiteLLM / Codex использует настройки плагина Codex.</p>
    <p className="text-muted-foreground">Память, субагенты и другие поддерживаемые параметры поведения настраиваются в основных провайдерах и применяются со следующего сообщения. Настройки моделей и подключения задаются здесь, в LiteLLM Agents.</p>
    <p className="text-muted-foreground">Chrome и Artifacts требуют соответствующих возможностей и авторизации основного Claude Code. Reasoning и Fast не наследуются: их поддержка зависит от корпоративной модели.</p>
  </div>;
}
export default definePluginApp(app => {
  app.slots.settingsSection({ id: "credentials", title: "Ключ LiteLLM", component: CredentialSettings });
  app.slots.settingsSection({ id: "behavior", title: "Настройки агентов", component: BehaviorSettings });
});
