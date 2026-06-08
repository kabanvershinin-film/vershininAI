'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ImageStudio, VideoStudio, ClippingStudio, VibeMotionStudio, LipSyncStudio, CinemaStudio, AudioStudio, MarketingStudio, WorkflowStudio, AgentStudio, AppsStudio, getUserBalance } from 'studio';

const DesignAgentStudio = dynamic(() => import('studio').then(mod => mod.DesignAgentStudio), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-black flex items-center justify-center text-white/20">Loading Design Studio...</div>
});
import axios from 'axios';
import ApiKeyModal from './ApiKeyModal';
import {
  getProviderApiKey,
  getProviderConfigSnapshot,
  loadProviderConfig,
  setProviderApiKey,
  setSelectedProvider,
} from 'studio';

const TABS = [
  { id: 'image',   label: 'Image Studio' },
  { id: 'video',   label: 'Video Studio' },
  { id: 'audio',   label: 'Audio Studio' },
  { id: 'clipping', label: 'AI Clipping' },
  { id: 'vibe-motion', label: 'Vibe Motion' },
  { id: 'lipsync', label: 'Lip Sync' },
  { id: 'cinema',  label: 'Cinema Studio' },
  { id: 'marketing', label: 'Marketing Studio' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'agents', label: 'Agents' },
  { id: 'design-agent', label: 'Design Agent' },
  { id: 'apps', label: 'Explore Apps' },
];

const STORAGE_KEY = 'muapi_key';
const MEMEFAST_KEY_STORAGE_KEY = 'genai_key_memefast';
const VOLCENGINE_KEY_STORAGE_KEY = 'genai_key_volcengine';
const MUAPI_ONLY_TABS = new Set(['workflows', 'agents', 'design-agent', 'apps']);

function normalizeMuapiKey(key) {
  return String(key || '')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .find(Boolean) || '';
}

export default function StandaloneShell() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug || []; 
  const idFromParams = params?.id;
  const tabFromParams = params?.tab;

  // Helper to extract workflow details precisely from either route structure
  const getWorkflowInfo = useCallback(() => {
    if (idFromParams) {
        return { id: idFromParams, tab: tabFromParams || null };
    }
    const wfIndex = slug.findIndex(s => s === 'workflows' || s === 'workflow');
    if (wfIndex === -1) return { id: null, tab: null };
    return {
      id: slug[wfIndex + 1] || null,
      tab: slug[wfIndex + 2] || null
    };
  }, [slug, idFromParams, tabFromParams]);

  const { id: urlWorkflowId } = getWorkflowInfo();

  // Initialize activeTab from URL slug/params or default to 'image'
  const getInitialTab = () => {
    if (idFromParams || slug.includes('workflow')) return 'workflows';
    if (slug.includes('agents')) return 'agents';
    if (slug.includes('design-agent')) return 'design-agent';
    if (slug.includes('apps')) return 'apps';
    const firstSegment = slug[0];
    if (firstSegment && TABS.find(t => t.id === firstSegment)) return firstSegment;
    return 'image';
  };
  
  const [apiKey, setApiKey] = useState(null);
  const [providerConfig, setProviderConfig] = useState(null);
  const [memefastKeyInput, setMemefastKeyInput] = useState('');
  const [volcengineKeyInput, setVolcengineKeyInput] = useState('');
  const [activeTab, setActiveTab] = useState(getInitialTab());

  const [balance, setBalance] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [hasMounted, setHasMounted] = useState(false);

  // Drag and Drop State
  const [isDragging, setIsDragging] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState(null);

  // Sync tab with URL if user navigates manually or via browser back/forward
  useEffect(() => {
    const info = getWorkflowInfo();
    if (info.id) {
        setActiveTab('workflows');
    } else if (slug.includes('agents')) {
        setActiveTab('agents');
    } else if (slug.includes('design-agent')) {
        setActiveTab('design-agent');
    } else if (slug.includes('apps')) {
        setActiveTab('apps');
    } else {
        const firstSegment = slug[0];
        if (firstSegment && TABS.find(t => t.id === firstSegment)) {
          setActiveTab(firstSegment);
        }
    }
  }, [slug, getWorkflowInfo]);

  const handleTabChange = (tabId) => {
    router.push(`/studio/${tabId}`);
    // setActiveTab(tabId);
  };

  // Auto-hide header when inside a specific workflow view or design agent
  useEffect(() => {
    const isEditingWorkflow = (activeTab === 'workflows' || !!idFromParams) && urlWorkflowId;
    const isDesignAgent = activeTab === 'design-agent';
    
    if (isEditingWorkflow || isDesignAgent) {
      setIsHeaderVisible(false);
    } else {
      setIsHeaderVisible(true);
    }
  }, [activeTab, urlWorkflowId, idFromParams]);

  // Global builder CSS cleanup when switching away from Workflows or Design Agent tabs
  useEffect(() => {
    const fromBuilder = sessionStorage.getItem("fromWorkflowBuilder");
    const fromDesignAgent = sessionStorage.getItem("fromDesignAgent");
    
    if ((fromBuilder && activeTab !== 'workflows') || (fromDesignAgent && activeTab !== 'design-agent')) {
      sessionStorage.removeItem("fromWorkflowBuilder");
      sessionStorage.removeItem("fromDesignAgent");
      window.location.reload();
    }
  }, [activeTab]);

  const fetchBalance = useCallback(async (key) => {
    try {
      const data = await getUserBalance(key);
      setBalance(data.balance);
    } catch (err) {
      console.error('Balance fetch failed:', err);
    }
  }, []);

  const refreshProviderState = useCallback((config = loadProviderConfig()) => {
    const snapshot = getProviderConfigSnapshot(config);
    const selectedProviderId = snapshot.selectedProviderId || 'memefast';
    const activeKey = getProviderApiKey(selectedProviderId);
    setProviderConfig(snapshot);
    setApiKey(activeKey || null);
    return { snapshot, selectedProviderId, activeKey };
  }, []);

  useEffect(() => {
    setHasMounted(true);
    setMemefastKeyInput(localStorage.getItem(MEMEFAST_KEY_STORAGE_KEY) || '');
    setVolcengineKeyInput(localStorage.getItem(VOLCENGINE_KEY_STORAGE_KEY) || '');
    const { selectedProviderId, activeKey } = refreshProviderState();
    const stored = normalizeMuapiKey(getProviderApiKey('muapi'));
    if (stored) {
      // Sync cookie immediately on mount to establish identity for background requests
      document.cookie = `muapi_key=${stored}; path=/; max-age=31536000; SameSite=Lax`;
    }
    if (selectedProviderId === 'muapi' && activeKey) {
      fetchBalance(activeKey);
    }
  }, [fetchBalance, refreshProviderState]);

  const handleKeySave = useCallback((key) => {
    const normalizedKey = normalizeMuapiKey(key);
    localStorage.setItem(STORAGE_KEY, normalizedKey);
    setProviderApiKey('muapi', normalizedKey);
    setApiKey(normalizedKey);
    fetchBalance(normalizedKey);
    document.cookie = `muapi_key=${normalizedKey}; path=/; max-age=31536000; SameSite=Lax`;
  }, [fetchBalance]);

  const handleKeyChange = useCallback(() => {
    const targetProviderId = MUAPI_ONLY_TABS.has(activeTab)
      ? 'muapi'
      : (providerConfig?.selectedProviderId || 'memefast');
    setProviderApiKey(targetProviderId, '');
    if (targetProviderId === 'muapi') {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('genai_key_muapi');
      setBalance(null);
      document.cookie = "muapi_key=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    }
    if (targetProviderId === 'memefast') {
      localStorage.removeItem(MEMEFAST_KEY_STORAGE_KEY);
      setMemefastKeyInput('');
    }
    if (targetProviderId === 'volcengine') {
      localStorage.removeItem(VOLCENGINE_KEY_STORAGE_KEY);
      setVolcengineKeyInput('');
    }
    setApiKey(null);
    refreshProviderState();
  }, [activeTab, providerConfig?.selectedProviderId, refreshProviderState]);

  const handleProviderChange = useCallback((providerId) => {
    const nextConfig = setSelectedProvider(providerId);
    const { activeKey } = refreshProviderState(nextConfig);
    if (providerId === 'muapi' && activeKey) {
      fetchBalance(activeKey);
    } else {
      setBalance(null);
    }
  }, [fetchBalance, refreshProviderState]);

  const handleMemefastKeySave = useCallback(() => {
    setProviderApiKey('memefast', memefastKeyInput.trim());
    refreshProviderState();
  }, [memefastKeyInput, refreshProviderState]);

  const handleVolcengineKeySave = useCallback(() => {
    setProviderApiKey('volcengine', volcengineKeyInput.trim());
    refreshProviderState();
  }, [volcengineKeyInput, refreshProviderState]);

  const handleRequiredKeySave = useCallback((key) => {
    const targetProviderId = MUAPI_ONLY_TABS.has(activeTab)
      ? 'muapi'
      : (providerConfig?.selectedProviderId || 'memefast');
    if (targetProviderId === 'muapi') {
      handleKeySave(key);
      return;
    }
    setProviderApiKey(targetProviderId, key);
    if (targetProviderId === 'memefast') {
      setMemefastKeyInput(key);
    }
    if (targetProviderId === 'volcengine') {
      setVolcengineKeyInput(key);
    }
    refreshProviderState();
  }, [activeTab, handleKeySave, providerConfig?.selectedProviderId, refreshProviderState]);

  // Inject API key into all outgoing Axios requests (prop-based approach)
  // We use an interceptor to be selective and NOT send the key to external domains like S3
  useEffect(() => {
    // Safety: Clear any global defaults that might have been set previously
    delete axios.defaults.headers.common['x-api-key'];

    if (!apiKey || providerConfig?.selectedProviderId !== 'muapi') return;

    const interceptorId = axios.interceptors.request.use((config) => {
      // Check if URL is local/proxied
      const isRelative = config.url.startsWith('/') || !config.url.startsWith('http');
      const isInternalProxy = config.url.includes('/api/app') || config.url.includes('/api/workflow') || config.url.includes('/api/agents') || config.url.includes('/api/api') || config.url.includes('/api/v1');

      if (isRelative || isInternalProxy) {
        config.headers['x-api-key'] = apiKey;
      }
      
      return config;
    });

    return () => {
      axios.interceptors.request.eject(interceptorId);
    };
  }, [apiKey, providerConfig?.selectedProviderId]);

  // Poll for balance every 30 seconds if key is present
  useEffect(() => {
    if (!apiKey || providerConfig?.selectedProviderId !== 'muapi') return;
    const interval = setInterval(() => fetchBalance(apiKey), 30000);
    return () => clearInterval(interval);
  }, [apiKey, fetchBalance, providerConfig?.selectedProviderId]);

  // Drag and Drop Handlers
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the container itself, not moving between children
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setDroppedFiles(files);
    }
  }, []);

  const handleFilesHandled = useCallback(() => {
    setDroppedFiles(null);
  }, []);

  if (!hasMounted) return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center">
      <div className="animate-spin text-[#22d3ee] text-3xl">◌</div>
    </div>
  );

  const selectedProviderId = providerConfig?.selectedProviderId || 'memefast';
  const providerOptions = (providerConfig?.providers || []).filter((provider) => provider.enabled !== false);
  const volcengineProvider = providerOptions.find((provider) => provider.id === 'volcengine');
  const muapiKey = getProviderApiKey('muapi');
  const activeTabRequiresMuapi = MUAPI_ONLY_TABS.has(activeTab);
  const requiredProviderId = activeTabRequiresMuapi ? 'muapi' : selectedProviderId;
  const requiredProvider = providerConfig?.providers?.find((provider) => provider.id === requiredProviderId);
  const requiredKeyMissing = activeTabRequiresMuapi ? !muapiKey : !apiKey;
  const studioPaneClass = (tabId) =>
    `absolute inset-0 ${activeTab === tabId ? 'block' : 'hidden pointer-events-none'}`;

  if (requiredKeyMissing) {
    return (
      <ApiKeyModal
        onSave={handleRequiredKeySave}
        providerId={requiredProviderId}
        providerName={requiredProvider?.name}
        providerUrl={requiredProviderId === 'muapi' ? 'https://muapi.ai/access-keys' : requiredProvider?.baseUrl}
      />
    );
  }

  return (
    <div 
      className="h-screen bg-[#030303] flex flex-col overflow-hidden text-white relative"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-[#22d3ee]/10 backdrop-blur-md border-4 border-dashed border-[#22d3ee]/50 flex items-center justify-center pointer-events-none transition-all duration-300">
          <div className="bg-[#0a0a0a] p-8 rounded-3xl border border-white/10 shadow-2xl flex flex-col items-center gap-4 scale-110 animate-pulse">
            <div className="w-20 h-20 bg-[#22d3ee] rounded-2xl flex items-center justify-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-xl font-bold text-white">Drop your media here</span>
              <span className="text-sm text-white/40">Images, videos, or audio files</span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      {isHeaderVisible && (
        <header className="flex-shrink-0 h-14 border-b border-white/[0.03] flex items-center justify-between px-6 bg-black/20 backdrop-blur-md z-40 gap-4">
          {/* Left: Logo */}
          <div className="flex-shrink-0 flex items-center gap-2">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span className="text-sm font-bold tracking-tight hidden sm:block">OpenGenerativeAI</span>
          </div>

          {/* Center: Navigation Container with fade edges */}
          <div className="flex-1 min-w-0 mx-4 sm:mx-6 relative overflow-hidden h-full flex items-center justify-start lg:justify-center">
            {/* Fade Left Overlay */}
            <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#030303] to-transparent pointer-events-none z-10 block lg:hidden" />
            
            <nav className="flex items-center gap-4 overflow-x-auto scrollbar-none w-full lg:w-auto h-full px-4 lg:px-0">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`relative text-[13px] font-medium transition-all duration-300 whitespace-nowrap px-1 flex-shrink-0 flex items-center h-full ${
                    activeTab === tab.id
                      ? 'text-[#22d3ee]'
                      : 'text-white/50 hover:text-white'
                  }`}
                >
                  <span className="relative z-10">{tab.label}</span>
                  {activeTab === tab.id && (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[#22d3ee] to-[#a855f7] rounded-full shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
                  )}
                </button>
              ))}
            </nav>
            
            {/* Fade Right Overlay */}
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#030303] to-transparent pointer-events-none z-10 block lg:hidden" />
          </div>

          {/* Right: Actions */}
          <div className="flex-shrink-0 flex items-center gap-4">
            <div className="flex items-center gap-3 bg-white/5 px-3 py-1.5 rounded-full border border-white/5 transition-colors">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-white/90">
                  {selectedProviderId === 'muapi' && balance !== null ? `$${balance}` : '---'}
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowSettings(true)}
              title="Settings — API key, local models, preferences"
              className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-white/10 bg-white/5 text-[13px] font-bold text-white/80 hover:text-white hover:bg-white/10 hover:border-white/20 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>Settings</span>
            </button>
          </div>
        </header>
      )}

      {/* Studio Content */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <div className={studioPaneClass('image')}>
          <ImageStudio apiKey={apiKey} droppedFiles={activeTab === 'image' ? droppedFiles : null} onFilesHandled={handleFilesHandled} />
        </div>
        <div className={studioPaneClass('video')}>
          <VideoStudio apiKey={apiKey} droppedFiles={activeTab === 'video' ? droppedFiles : null} onFilesHandled={handleFilesHandled} />
        </div>
        <div className={studioPaneClass('clipping')}>
          <ClippingStudio apiKey={apiKey} droppedFiles={activeTab === 'clipping' ? droppedFiles : null} onFilesHandled={handleFilesHandled} />
        </div>
        <div className={studioPaneClass('vibe-motion')}>
          <VibeMotionStudio apiKey={apiKey} />
        </div>
        <div className={studioPaneClass('lipsync')}>
          <LipSyncStudio apiKey={apiKey} droppedFiles={activeTab === 'lipsync' ? droppedFiles : null} onFilesHandled={handleFilesHandled} />
        </div>
        <div className={studioPaneClass('cinema')}>
          <CinemaStudio apiKey={apiKey} />
        </div>
        <div className={studioPaneClass('audio')}>
          <AudioStudio apiKey={apiKey} droppedFiles={activeTab === 'audio' ? droppedFiles : null} onFilesHandled={handleFilesHandled} />
        </div>
        <div className={studioPaneClass('marketing')}>
          <MarketingStudio apiKey={apiKey} droppedFiles={activeTab === 'marketing' ? droppedFiles : null} onFilesHandled={handleFilesHandled} />
        </div>
        {activeTab === 'workflows' && <WorkflowStudio apiKey={muapiKey} isHeaderVisible={isHeaderVisible} onToggleHeader={setIsHeaderVisible} />}
        {activeTab === 'agents' && <AgentStudio apiKey={muapiKey} isHeaderVisible={isHeaderVisible} onToggleHeader={setIsHeaderVisible} />}
        {activeTab === 'design-agent' && <DesignAgentStudio apiKey={muapiKey} isHeaderVisible={isHeaderVisible} onToggleHeader={setIsHeaderVisible} />}
        {activeTab === 'apps' && <AppsStudio apiKey={muapiKey} />}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in-up">
          <div className="bg-[#0a0a0a] border border-white/10 rounded-xl p-8 w-full max-w-sm shadow-2xl">
            <h2 className="text-white font-bold text-lg mb-2">Settings</h2>
            <p className="text-white/40 text-[13px] mb-8">
              Manage your AI studio preferences and authentication.
            </p>
            
            <div className="space-y-4 mb-8">
              <div className="bg-white/5 border border-white/[0.03] rounded-md p-4">
                <label className="block text-xs font-bold text-white/30 mb-2">
                  Default Provider
                </label>
                <select
                  value={providerConfig?.selectedProviderId || 'memefast'}
                  onChange={(event) => handleProviderChange(event.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white"
                >
                  {providerOptions.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name || provider.id}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-white/35 mt-2">
                  This is a global switch. Unsupported features fail instead of silently falling back to another provider.
                </p>
              </div>

              <div className="bg-white/5 border border-white/[0.03] rounded-md p-4">
                <label className="block text-xs font-bold text-white/30 mb-2">
                   Active {selectedProviderId} API Key
                </label>
                <div className="text-[13px] font-mono text-white/80">
                  {apiKey ? `${apiKey.slice(0, 8)}••••••••••••••••` : 'Missing'}
                </div>
              </div>

              <div className="bg-white/5 border border-white/[0.03] rounded-md p-4">
                <label className="block text-xs font-bold text-white/30 mb-2">
                  MemeFast API Key
                </label>
                <input
                  type="password"
                  value={memefastKeyInput}
                  onChange={(event) => setMemefastKeyInput(event.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/20"
                />
                <button
                  onClick={handleMemefastKeySave}
                  className="mt-3 h-9 px-3 rounded-md bg-white/10 text-white/80 hover:bg-white/15 text-xs font-semibold transition-all"
                >
                  Save MemeFast Key
                </button>
              </div>

              <div className="bg-white/5 border border-white/[0.03] rounded-md p-4">
                <label className="block text-xs font-bold text-white/30 mb-2">
                  Volcengine Ark API Key
                </label>
                <div className="text-[11px] text-white/35 mb-2">
                  Base URL: {volcengineProvider?.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3'}
                </div>
                <input
                  type="password"
                  value={volcengineKeyInput}
                  onChange={(event) => setVolcengineKeyInput(event.target.value)}
                  placeholder="volcengine ark key..."
                  className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/20"
                />
                <p className="text-[11px] text-white/35 mt-2">
                  Official Seedance 2.0 models: doubao-seedance-2-0-260128, doubao-seedance-2-0-fast-260128.
                </p>
                <button
                  onClick={handleVolcengineKeySave}
                  className="mt-3 h-9 px-3 rounded-md bg-white/10 text-white/80 hover:bg-white/15 text-xs font-semibold transition-all"
                >
                  Save Volcengine Key
                </button>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleKeyChange}
                className="flex-1 h-10 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-all"
              >
                Change Key
              </button>
              <button
                onClick={() => setShowSettings(false)}
                className="flex-1 h-10 rounded-md bg-white/5 text-white/80 hover:bg-white/10 text-xs font-semibold transition-all border border-white/5"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
