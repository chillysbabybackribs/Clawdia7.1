import React, { useState, useEffect, useCallback } from 'react';

interface IdentityProfile {
  id: number;
  name: string;
  fullName: string;
  email: string;
  usernamePattern: string;
  dateOfBirth?: string;
  isDefault: boolean;
}

interface ManagedAccountView {
  id: number;
  serviceName: string;
  loginUrl: string;
  username: string;
  emailUsed: string;
  phoneUsed: string;
  phoneMethod: string;
  status: 'active' | 'suspended' | 'unverified';
  accessType: 'session' | 'vault' | 'managed';
  source: 'managed' | 'session';
  createdAt: string;
  notes: string;
}

interface CredentialView {
  label: string;
  type: string;
  service: string;
  maskedValue: string;
}

export default function IdentitySection() {
  const api = (window as any).clawdia?.identity;

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [usernamePattern, setUsernamePattern] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  const [accounts, setAccounts] = useState<ManagedAccountView[]>([]);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccountService, setNewAccountService] = useState('');
  const [newAccountUsername, setNewAccountUsername] = useState('');
  const [newAccountPassword, setNewAccountPassword] = useState('');

  const [credentials, setCredentials] = useState<CredentialView[]>([]);
  const [showAddCred, setShowAddCred] = useState(false);
  const [newCredLabel, setNewCredLabel] = useState('');
  const [newCredType, setNewCredType] = useState<'api_key' | 'session_token' | 'app_password' | 'oauth_token'>('api_key');
  const [newCredService, setNewCredService] = useState('');
  const [newCredValue, setNewCredValue] = useState('');

  const loadAccounts = useCallback(async () => {
    if (!api) return;
    const list = await api.listAccounts();
    setAccounts(list || []);
  }, [api]);

  useEffect(() => {
    if (!api) return;

    api.getProfile().then((profile: IdentityProfile | null) => {
      if (!profile) return;
      setFullName(profile.fullName || '');
      setEmail(profile.email || '');
      setUsernamePattern(profile.usernamePattern || '');
      setDateOfBirth(profile.dateOfBirth || '');
    });

    loadAccounts();
    api.listCredentials().then((list: CredentialView[]) => setCredentials(list || []));

    const cleanup = api.onAccountsChanged(() => loadAccounts());
    return cleanup;
  }, [api, loadAccounts]);

  const handleSaveProfile = async () => {
    if (!api) return;
    await api.setProfile({ fullName, email, usernamePattern, dateOfBirth });
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2000);
  };

  const handleAddAccount = async () => {
    if (!api || !newAccountService.trim()) return;
    await api.addAccount({
      serviceName: newAccountService.trim(),
      username: newAccountUsername.trim(),
      passwordPlain: newAccountPassword,
    });
    setNewAccountService('');
    setNewAccountUsername('');
    setNewAccountPassword('');
    setShowAddAccount(false);
    await loadAccounts();
  };

  const handleDeleteAccount = async (serviceName: string) => {
    if (!api) return;
    await api.deleteAccount(serviceName);
    await loadAccounts();
  };

  const handleAddCredential = async () => {
    if (!api || !newCredLabel.trim()) return;
    await api.addCredential(newCredLabel.trim(), newCredType, newCredService.trim(), newCredValue);
    setNewCredLabel('');
    setNewCredType('api_key');
    setNewCredService('');
    setNewCredValue('');
    setShowAddCred(false);
    const list = await api.listCredentials();
    setCredentials(list || []);
  };

  const handleDeleteCredential = async (label: string, service: string) => {
    if (!api) return;
    await api.deleteCredential(label, service);
    const list = await api.listCredentials();
    setCredentials(list || []);
  };

  const accessPill = (accessType: string) => {
    const config = ({
      session: { color: 'text-[#4ade80]', bg: 'bg-[#4ade80]/10', label: 'Session' },
      vault:   { color: 'text-[#fbbf24]', bg: 'bg-[#fbbf24]/10', label: 'Vault' },
      managed: { color: 'text-accent',    bg: 'bg-accent/10',    label: 'Managed' },
    } as Record<string, { color: string; bg: string; label: string }>)[accessType]
      ?? { color: 'text-text-muted', bg: 'bg-white/5', label: accessType };
    return (
      <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full ${config.bg} ${config.color}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        {config.label}
      </span>
    );
  };

  const credIcon = (type: string) => {
    if (type === 'api_key') return '🔑';
    if (type === 'oauth_token') return '🔗';
    return '🔒';
  };

  const inputCls = 'w-full h-[34px] bg-surface-2 text-text-primary text-sm pl-3 pr-3 rounded-lg border border-border placeholder:text-text-muted outline-none focus:border-accent/40 transition-colors';

  return (
    <>
      <section className="flex flex-col gap-2">
        <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">Identity Profile</label>
        <p className="text-2xs text-text-muted -mt-1">
          Clawdia uses this when signing up for services on your behalf. Leave fields blank to exclude them.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-text-muted">Full name</span>
            <input className={inputCls} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-text-muted">Email</span>
            <input className={inputCls} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-text-muted">Username pattern</span>
            <input className={inputCls} value={usernamePattern} onChange={e => setUsernamePattern(e.target.value)} placeholder="e.g. dp_, dp123" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-text-muted">Date of birth</span>
            <input className={inputCls} value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} placeholder="YYYY-MM-DD" />
          </div>
        </div>

        <button
          onClick={handleSaveProfile}
          className={`self-start h-[34px] px-4 rounded-lg text-sm font-medium transition-all cursor-pointer ${
            profileSaved ? 'bg-status-success/20 text-status-success' : 'bg-accent/90 hover:bg-accent text-surface-0'
          }`}
        >
          {profileSaved ? 'Saved ✓' : 'Save Profile'}
        </button>
      </section>

      <div className="h-px bg-border-subtle" />

      <section className="flex flex-col gap-2">
        <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">Accounts</label>
        <p className="text-2xs text-text-muted -mt-1">
          All accounts Clawdia can access. Session cookies take priority over saved credentials.
        </p>

        {accounts.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {['Service', 'Username', 'Access', ''].map(h => (
                  <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted pb-2 px-1">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map(acc => (
                <tr key={acc.source === 'session' ? acc.serviceName : String(acc.id)} className="group border-t border-surface-2 hover:bg-white/[0.02]">
                  <td className="px-1 py-1.5 text-text-primary text-xs">{acc.serviceName}</td>
                  <td className="px-1 py-1.5 text-text-secondary text-xs">{acc.username || acc.emailUsed || '—'}</td>
                  <td className="px-1 py-1.5">{accessPill(acc.accessType)}</td>
                  <td className="px-1 py-1.5 text-right">
                    {acc.source === 'managed' ? (
                      <button
                        onClick={() => handleDeleteAccount(acc.serviceName)}
                        className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:bg-red-500/10 hover:text-red-400 transition-colors cursor-pointer"
                        title="Remove account"
                      >
                        ✕
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {showAddAccount && (
          <div className="flex flex-col gap-2 p-3 rounded-xl border border-border bg-surface-2/50">
            <div className="grid grid-cols-3 gap-2">
              <input className={inputCls} placeholder="Service (e.g. reddit.com)" value={newAccountService} onChange={e => setNewAccountService(e.target.value)} />
              <input className={inputCls} placeholder="Username" value={newAccountUsername} onChange={e => setNewAccountUsername(e.target.value)} />
              <input className={inputCls} type="password" placeholder="Password" value={newAccountPassword} onChange={e => setNewAccountPassword(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button onClick={handleAddAccount} className="h-[30px] px-3 rounded-lg bg-accent/90 hover:bg-accent text-surface-0 text-xs font-medium cursor-pointer transition-colors">Add</button>
              <button onClick={() => setShowAddAccount(false)} className="h-[30px] px-3 rounded-lg text-text-muted hover:text-text-secondary text-xs cursor-pointer transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {!showAddAccount && (
          <button
            onClick={() => setShowAddAccount(true)}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary border border-dashed border-border hover:border-border-subtle rounded-lg px-3 py-2 transition-colors cursor-pointer w-full bg-transparent"
          >
            <span className="text-base leading-none">＋</span> Add account manually
          </button>
        )}
      </section>

      <div className="h-px bg-border-subtle" />

      <section className="flex flex-col gap-2">
        <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">Credential Vault</label>
        <p className="text-2xs text-text-muted -mt-1">
          API keys, tokens, and passwords stored encrypted on this device.
        </p>

        {credentials.map(cred => (
          <div key={`${cred.label}:${cred.service}`} className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl border border-border bg-surface-2/40">
            <div className="w-7 h-7 rounded-lg bg-surface-2 flex items-center justify-center text-sm flex-shrink-0">
              {credIcon(cred.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text-primary font-medium truncate">{cred.label}</div>
              <div className="text-[10px] text-text-muted">{cred.type} · {cred.service || '—'}</div>
            </div>
            <div className="text-[11px] text-text-muted font-mono flex-shrink-0">{cred.maskedValue}</div>
            <button
              onClick={() => handleDeleteCredential(cred.label, cred.service)}
              className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:bg-red-500/10 hover:text-red-400 transition-colors cursor-pointer flex-shrink-0"
              title="Delete credential"
            >
              ✕
            </button>
          </div>
        ))}

        {showAddCred && (
          <div className="flex flex-col gap-2 p-3 rounded-xl border border-border bg-surface-2/50">
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder="Label (e.g. twilio-sid)" value={newCredLabel} onChange={e => setNewCredLabel(e.target.value)} />
              <select
                value={newCredType}
                onChange={e => setNewCredType(e.target.value as any)}
                className="h-[34px] bg-surface-2 text-text-primary text-sm pl-3 rounded-lg border border-border outline-none focus:border-accent/40 transition-colors"
              >
                <option value="api_key">API Key</option>
                <option value="session_token">Session Token</option>
                <option value="app_password">App Password</option>
                <option value="oauth_token">OAuth Token</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder="Service (e.g. twilio)" value={newCredService} onChange={e => setNewCredService(e.target.value)} />
              <input className={inputCls} type="password" placeholder="Value" value={newCredValue} onChange={e => setNewCredValue(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button onClick={handleAddCredential} className="h-[30px] px-3 rounded-lg bg-accent/90 hover:bg-accent text-surface-0 text-xs font-medium cursor-pointer transition-colors">Add</button>
              <button onClick={() => setShowAddCred(false)} className="h-[30px] px-3 rounded-lg text-text-muted hover:text-text-secondary text-xs cursor-pointer transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {!showAddCred && (
          <button
            onClick={() => setShowAddCred(true)}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary border border-dashed border-border hover:border-border-subtle rounded-lg px-3 py-2 transition-colors cursor-pointer w-full bg-transparent"
          >
            <span className="text-base leading-none">＋</span> Add credential
          </button>
        )}
      </section>
    </>
  );
}
