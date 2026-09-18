document.addEventListener('DOMContentLoaded', () => {
  // Voyo Catalog Genres & Tags
  const ALL_GENRES = [
    'Akcija', 'Animirani', 'Balkanski', 'Biografski', 'Dokumentarni', 'Drama',
    'Družinski', 'Fantazija', 'Grozljivka', 'Komedija', 'Kriminalka',
    'Pustolovščina', 'Romanca', 'Sci-Fi', 'Slovenski', 'Triler', 'Vojni',
    'Otroški', 'Resničnostni šov', 'Kratki filmi'
  ];

  const SCHEDULE_LABELS = {
    'disabled': 'Onemogočeno (Ročni zagon)',
    'every_1h': 'Vsako 1 uro',
    'every_2h': 'Vsaki 2 uri',
    'every_4h': 'Vsake 4 ure',
    'every_6h': 'Vsakih 6 ur',
    'every_8h': 'Vsakih 8 ur',
    'every_12h': 'Vsakih 12 ur',
    'every_24h': 'Vsakih 24 ur (Dnevno)',
    'daily': 'Dnevno'
  };

  let globalConfig = null;
  let allJobs = [];
  let isSyncing = false;
  let runningJobId = null;

  // File Explorer State
  let currentExplorerPath = '';
  let currentExplorerItems = [];

  // DOM Elements
  const toggleSettingsBtn = document.getElementById('toggle-settings-btn');
  const globalSettingsForm = document.getElementById('global-settings-form');
  const testAuthBtn = document.getElementById('test-auth-btn');
  const testJellyfinBtn = document.getElementById('test-jellyfin-btn');
  const massConvertSubtitlesBtn = document.getElementById('mass-convert-subtitles-btn');
  const jobsGridContainer = document.getElementById('jobs-grid-container');
  const createJobBtn = document.getElementById('create-job-btn');
  const profileSelect = document.getElementById('profileId');

  // File Explorer Elements
  const explorerRootSelect = document.getElementById('explorer-root-select');
  const explorerRefreshBtn = document.getElementById('explorer-refresh-btn');
  const explorerBreadcrumbs = document.getElementById('explorer-breadcrumbs');
  const explorerSearchInput = document.getElementById('explorer-search-input');
  const explorerItemCount = document.getElementById('explorer-item-count');
  const explorerTableBody = document.getElementById('explorer-table-body');

  // File Editor Modal Elements
  const fileEditorModal = document.getElementById('file-editor-modal');
  const fileEditorTitle = document.getElementById('file-editor-title');
  const fileEditorPath = document.getElementById('file-editor-path');
  const fileEditorContent = document.getElementById('file-editor-content');
  const fileEditorCloseBtn = document.getElementById('file-editor-close-btn');
  const fileEditorCancelBtn = document.getElementById('file-editor-cancel-btn');
  const fileEditorSaveBtn = document.getElementById('file-editor-save-btn');
  const fileImagePreviewContainer = document.getElementById('file-image-preview-container');
  const fileImagePreview = document.getElementById('file-image-preview');
  const fileEditorTextareaContainer = document.getElementById('file-editor-textarea-container');

  // Terminal & Logs Elements
  const logsModal = document.getElementById('logs-modal');
  const logsCloseBtn = document.getElementById('logs-close-btn');
  const logsCancelBtn = document.getElementById('logs-cancel-btn');
  const btnOpenSyncLogs = document.getElementById('btn-open-sync-logs');
  const btnOpenBridgeLogs = document.getElementById('btn-open-bridge-logs');
  const btnOpenHistory = document.getElementById('btn-open-history');
  const tabSyncLogs = document.getElementById('tab-sync-logs');
  const tabBridgeLogs = document.getElementById('tab-bridge-logs');
  const tabJobHistory = document.getElementById('tab-job-history');
  const clearLogsBtn = document.getElementById('clear-logs-btn');
  const logOutput = document.getElementById('log-output');
  const bridgeLogOutput = document.getElementById('bridge-log-output');
  const historyContainer = document.getElementById('history-container');
  const historyList = document.getElementById('history-list');
  const syncRunningTag = document.getElementById('sync-running-tag');

  // Job Modal Elements
  const jobModal = document.getElementById('job-modal');
  const jobForm = document.getElementById('job-form');
  const jobModalTitle = document.getElementById('job-modal-title');
  const jobModalCloseBtn = document.getElementById('job-modal-close-btn');
  const jobModalCancelBtn = document.getElementById('job-modal-cancel-btn');
  const jobPreviewBtn = document.getElementById('job-preview-btn');
  const genreContainer = document.getElementById('genre-checkbox-container');

  // Preview Modal Elements
  const previewModal = document.getElementById('preview-modal');
  const previewCloseBtn = document.getElementById('preview-close-btn');
  const previewCancelBtn = document.getElementById('preview-cancel-btn');
  const previewSummaryTags = document.getElementById('preview-summary-tags');
  const previewItemsBody = document.getElementById('preview-items-body');
  const previewSearchInput = document.getElementById('preview-search-input');
  const previewSelectAllBtn = document.getElementById('preview-select-all-btn');
  const previewDeselectAllBtn = document.getElementById('preview-deselect-all-btn');
  const previewSyncSelectedBtn = document.getElementById('preview-sync-selected-btn');
  const previewSelectedCounterText = document.getElementById('preview-selected-counter-text');
  const btnQuickPreview = document.getElementById('btn-quick-preview');
  const previewTabAll = document.getElementById('preview-tab-all');
  const previewTabShows = document.getElementById('preview-tab-shows');
  const previewTabMovies = document.getElementById('preview-tab-movies');
  const previewCountAll = document.getElementById('preview-count-all');
  const previewCountShows = document.getElementById('preview-count-shows');
  const previewCountMovies = document.getElementById('preview-count-movies');
  const previewRefreshBtn = document.getElementById('preview-refresh-btn');

  const toast = document.getElementById('toast');

  function showToast(msg, type = 'success') {
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast toast-${type}`;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3500);
  }

  const settingsModal = document.getElementById('settings-modal');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
  const statActiveJobs = document.getElementById('stat-active-jobs');
  const statSyncStatus = document.getElementById('stat-sync-status');
  const statJellyfinStatus = document.getElementById('stat-jellyfin-status');

  function openModal(modalEl) {
    if (!modalEl) return;
    modalEl.style.display = 'flex';
    document.body.classList.add('modal-open');
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.style.display = 'none';
    // Only remove modal-open if no other modals are currently visible
    const anyOpen = document.querySelectorAll('.modal[style*="display: flex"]');
    if (!anyOpen || anyOpen.length === 0) {
      document.body.classList.remove('modal-open');
    }
  }

  toggleSettingsBtn?.addEventListener('click', () => {
    openModal(settingsModal);
    loadVoyoProfiles();
  });
  closeSettingsBtn?.addEventListener('click', () => closeModal(settingsModal));
  cancelSettingsBtn?.addEventListener('click', () => closeModal(settingsModal));

  // Logs modal controls
  btnOpenSyncLogs?.addEventListener('click', () => {
    openModal(logsModal);
    switchLogsTab('sync');
  });
  btnOpenBridgeLogs?.addEventListener('click', () => {
    openModal(logsModal);
    switchLogsTab('bridge');
  });
  btnOpenHistory?.addEventListener('click', () => {
    openModal(logsModal);
    switchLogsTab('history');
  });
  logsCloseBtn?.addEventListener('click', () => closeModal(logsModal));
  logsCancelBtn?.addEventListener('click', () => closeModal(logsModal));

  function switchLogsTab(tab) {
    tabSyncLogs.className = tab === 'sync' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
    tabBridgeLogs.className = tab === 'bridge' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
    tabJobHistory.className = tab === 'history' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';

    logOutput.style.display = tab === 'sync' ? 'block' : 'none';
    bridgeLogOutput.style.display = tab === 'bridge' ? 'block' : 'none';
    historyContainer.style.display = tab === 'history' ? 'block' : 'none';
  }

  tabSyncLogs?.addEventListener('click', () => switchLogsTab('sync'));
  tabBridgeLogs?.addEventListener('click', () => switchLogsTab('bridge'));
  tabJobHistory?.addEventListener('click', () => switchLogsTab('history'));

  clearLogsBtn?.addEventListener('click', async () => {
    try {
      await fetch('/api/logs', { method: 'DELETE' });
      logOutput.textContent = '';
      bridgeLogOutput.textContent = '';
      showToast('Dnevniki počiščeni');
    } catch {}
  });

  function updateQuickStats() {
    if (statActiveJobs && allJobs) {
      const activeCount = allJobs.filter(j => j.enabled !== false && j.schedule !== 'disabled').length;
      statActiveJobs.textContent = `${activeCount} / ${allJobs.length}`;
    }

    if (statSyncStatus) {
      if (isSyncing) {
        statSyncStatus.textContent = '⚡ Sinhronizacija teče';
        statSyncStatus.style.color = '#8b5cf6';
      } else {
        statSyncStatus.textContent = 'Pripravljen';
        statSyncStatus.style.color = '#34d399';
      }
    }

    if (statJellyfinStatus && globalConfig) {
      if (globalConfig.jellyfinAutoRefresh && globalConfig.jellyfinUrl) {
        statJellyfinStatus.textContent = '✅ Povezan & Auto';
        statJellyfinStatus.style.color = '#34d399';
      } else if (globalConfig.jellyfinUrl) {
        statJellyfinStatus.textContent = '🔗 Nastavljen';
        statJellyfinStatus.style.color = '#38bdf8';
      } else {
        statJellyfinStatus.textContent = 'Ni nastavljeno';
        statJellyfinStatus.style.color = '#9ca3af';
      }
    }
  }

  // Populate profiles in select
  async function loadVoyoProfiles() {
    if (!profileSelect) return;
    try {
      const res = await fetch('/api/voyo/profiles');
      const data = await res.json();
      if (data.success && data.profiles) {
        profileSelect.innerHTML = '<option value="">Izberi profil (samodejno)...</option>';
        for (const prof of data.profiles) {
          const opt = document.createElement('option');
          opt.value = prof.profileId;
          opt.textContent = `${prof.name} (${prof.type || 'profil'})`;
          if (globalConfig && globalConfig.profileId === prof.profileId) {
            opt.selected = true;
          }
          profileSelect.appendChild(opt);
        }
      }
    } catch {}
  }

  // Load Initial Settings & Jobs
  async function loadInitialData() {
    try {
      const res = await fetch('/api/settings');
      globalConfig = await res.json();

      document.getElementById('username').value = globalConfig.username || '';
      document.getElementById('password').value = globalConfig.password || '';
      document.getElementById('streamMode').value = globalConfig.streamMode || 'proxy';
      document.getElementById('bridgeUrl').value = globalConfig.bridgeUrl || 'http://localhost:3851';
      document.getElementById('port').value = globalConfig.port || 3851;
      document.getElementById('jellyfinUrl').value = globalConfig.jellyfinUrl || '';
      document.getElementById('jellyfinApiKey').value = globalConfig.jellyfinApiKey || '';
      document.getElementById('jellyfinAutoRefresh').checked = globalConfig.jellyfinAutoRefresh !== false;

      allJobs = globalConfig.jobs || [];
      renderJobsList(allJobs);
      loadExplorerRoots();
      updateQuickStats();
      loadVoyoProfiles();
    } catch (err) {
      showToast(`Napaka pri branju konfiguracije: ${err.message}`, 'error');
    }
  }

  // Render Job Cards Grid
  function renderJobsList(jobs = []) {
    if (!jobsGridContainer) return;
    if (jobs.length === 0) {
      jobsGridContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">Ni ustvarjenih opravil. Kliknite "Novo Opravilo".</div>';
      return;
    }

    jobsGridContainer.innerHTML = jobs.map(job => {
      const isRunning = isSyncing && runningJobId === job.id;
      const statusPill = isRunning
        ? '<span class="job-pill job-pill-running">TEČE ZDAJ</span>'
        : (job.enabled !== false
          ? '<span class="job-pill job-pill-enabled">AKTIVNO</span>'
          : '<span class="job-pill job-pill-disabled">PREMOR</span>');

      const schedLabel = SCHEDULE_LABELS[job.schedule] || job.schedule || 'Onemogočeno';

      return `
        <div class="job-card" data-id="${job.id}">
          <div class="job-card-header">
            <div class="job-title">${escapeHtml(job.name)}</div>
            ${statusPill}
          </div>
          <div class="job-meta-row">
            <span>⏰ ${schedLabel}</span>
            <span>📁 ${escapeHtml(job.targetDir || 'Privzeto')}</span>
            <span>🎯 ${job.mediaTypeFilter === 'movies' ? 'Samo Filmi' : (job.mediaTypeFilter === 'shows' ? 'Samo Serije' : 'Vse')}</span>
            ${job.titleFilter ? `<span style="color:#a78bfa; font-weight:600;">🎯 ${escapeHtml(job.titleFilter)}</span>` : ''}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
            <span style="font-size: 0.75rem; color: var(--text-muted);">Zadnji zagon: ${job.lastRun || 'Nikoli'}</span>
            <div style="display: flex; gap: 0.4rem;">
              <button type="button" class="btn btn-outline btn-sm btn-job-edit" data-id="${job.id}">✏️ Uredi</button>
              <button type="button" class="btn btn-primary btn-sm btn-job-run" data-id="${job.id}" ${isRunning ? 'disabled' : ''}>
                ${isRunning ? '⏳ Teče...' : '▶️ Zaženi'}
              </button>
              <button type="button" class="btn btn-outline btn-sm btn-job-delete" data-id="${job.id}" title="Odstrani opravilo" style="color:#ef4444;">🗑️</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach button listeners
    document.querySelectorAll('.btn-job-edit').forEach(b => {
      b.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        openEditJobModal(id);
      });
    });

    document.querySelectorAll('.btn-job-run').forEach(b => {
      b.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        try {
          const res = await fetch('/api/jobs/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId: id, force: false })
          });
          const data = await res.json();
          if (data.success) {
            showToast('Opravilo zagnano!', 'success');
          } else {
            showToast(`Napaka: ${data.message}`, 'error');
          }
        } catch (err) {
          showToast(`Napaka: ${err.message}`, 'error');
        }
      });
    });

    document.querySelectorAll('.btn-job-delete').forEach(b => {
      b.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const targetJob = allJobs.find(j => j.id === id);
        if (!confirm(`Ali želite odstraniti opravilo:\n"${targetJob?.name || id}"?`)) return;

        try {
          const res = await fetch('/api/jobs/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId: id })
          });
          const data = await res.json();
          if (data.success) {
            showToast('Opravilo odstranjeno', 'success');
            allJobs = data.jobs;
            renderJobsList(allJobs);
            updateQuickStats();
          } else {
            showToast(`Napaka: ${data.message}`, 'error');
          }
        } catch (err) {
          showToast(`Napaka: ${err.message}`, 'error');
        }
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // Populate Genres in Job Modal
  function renderGenreCheckboxes(selected = []) {
    if (!genreContainer) return;
    genreContainer.innerHTML = ALL_GENRES.map(g => {
      const isChecked = selected.includes(g);
      return `
        <label class="genre-item">
          <input type="checkbox" name="selectedGenres" value="${g}" ${isChecked ? 'checked' : ''} />
          <span>${g}</span>
        </label>
      `;
    }).join('');
  }

  document.getElementById('genre-select-all')?.addEventListener('click', () => {
    genreContainer.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = true);
  });
  document.getElementById('genre-clear-all')?.addEventListener('click', () => {
    genreContainer.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = false);
  });
  document.getElementById('genre-slo-only')?.addEventListener('click', () => {
    genreContainer.querySelectorAll('input[type="checkbox"]').forEach(c => {
      c.checked = c.value.toLowerCase().includes('slovenski') || c.value.toLowerCase().includes('balkanski');
    });
  });

  // Open Create / Edit Job Modal
  createJobBtn?.addEventListener('click', () => {
    jobModalTitle.textContent = '➕ Novo Sinhronizacijsko Opravilo';
    jobForm.reset();
    document.getElementById('job-id').value = '';
    document.getElementById('job-target-dir').value = globalConfig?.moviesDir || '/media/MoviesVoyo';
    openModal(jobModal);
  });

  function openEditJobModal(jobId) {
    const job = allJobs.find(j => j.id === jobId);
    if (!job) return;

    jobModalTitle.textContent = '⚙️ Uredi Opravilo: ' + job.name;
    document.getElementById('job-id').value = job.id;
    document.getElementById('job-name').value = job.name || '';
    document.getElementById('job-target-dir').value = job.targetDir || '';
    document.getElementById('job-schedule').value = job.schedule || 'every_24h';
    document.getElementById('job-title-filter').value = job.titleFilter || '';
    document.getElementById('job-media-type').value = job.mediaTypeFilter || 'all';
    document.getElementById('job-item-limit').value = job.itemLimit || 0;
    document.getElementById('job-min-year').value = job.minYear || '';
    document.getElementById('job-min-rating').value = job.minRating || '';
    document.getElementById('job-naming').value = job.languagePreference || 'sl';

    renderGenreCheckboxes(job.selectedGenres || []);
    openModal(jobModal);
  }

  jobModalCloseBtn?.addEventListener('click', () => closeModal(jobModal));
  jobModalCancelBtn?.addEventListener('click', () => closeModal(jobModal));

  // Save Job Form
  jobForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(jobForm);
    const selectedGenres = Array.from(formData.getAll('selectedGenres'));

    const jobData = {
      id: document.getElementById('job-id').value || null,
      name: formData.get('name'),
      targetDir: formData.get('targetDir'),
      schedule: formData.get('schedule'),
      titleFilter: formData.get('titleFilter') ? formData.get('titleFilter').trim() : null,
      mediaTypeFilter: formData.get('mediaTypeFilter'),
      itemLimit: parseInt(formData.get('itemLimit') || '0', 10),
      minYear: formData.get('minYear') ? parseInt(formData.get('minYear'), 10) : null,
      minRating: formData.get('minRating') ? parseFloat(formData.get('minRating')) : null,
      languagePreference: formData.get('languagePreference'),
      selectedGenres
    };

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobData)
      });
      const data = await res.json();
      if (data.success) {
        showToast('Opravilo uspešno shranjeno!', 'success');
        allJobs = data.jobs;
        renderJobsList(allJobs);
        closeModal(jobModal);
        updateQuickStats();
      } else {
        showToast(`Napaka: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Napaka: ${err.message}`, 'error');
    }
  });

  // ==========================================
  // Track Series Modal & Workflow
  // ==========================================
  const trackModal = document.getElementById('track-modal');
  const trackModalForm = document.getElementById('track-modal-form');
  const trackModalCloseBtn = document.getElementById('track-modal-close-btn');
  const trackModalCancelBtn = document.getElementById('track-modal-cancel-btn');
  const trackModalSeriesDisplay = document.getElementById('track-modal-series-display');
  const trackSeriesNameInput = document.getElementById('track-series-name');
  const trackSeriesUrlInput = document.getElementById('track-series-url');
  const trackTargetDirInput = document.getElementById('track-target-dir');
  const trackScheduleSelect = document.getElementById('track-schedule-select');

  function openTrackSeriesModal(seriesName, seriesUrl = '', targetDir = '') {
    if (!trackModal) return;
    trackSeriesNameInput.value = seriesName;
    trackSeriesUrlInput.value = seriesUrl;
    trackTargetDirInput.value = targetDir || globalConfig?.showsDir || '/media/ShowsVoyo';
    trackModalSeriesDisplay.textContent = seriesName;
    openModal(trackModal);
  }

  trackModalCloseBtn?.addEventListener('click', () => closeModal(trackModal));
  trackModalCancelBtn?.addEventListener('click', () => closeModal(trackModal));

  trackModalForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const seriesName = trackSeriesNameInput.value.trim();
    const seriesUrl = trackSeriesUrlInput.value.trim();
    const schedule = trackScheduleSelect.value;
    const targetDir = trackTargetDirInput.value.trim() || globalConfig?.showsDir || '/media/ShowsVoyo';

    const newJob = {
      id: `track_${Date.now()}`,
      name: `🔔 Spremljanje: ${seriesName}`,
      enabled: true,
      schedule,
      targetDir,
      mediaTypeFilter: 'shows',
      titleFilter: seriesUrl || seriesName,
      itemLimit: 0,
      minYear: null,
      minRating: null,
      selectedGenres: [],
      languagePreference: 'sl'
    };

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newJob)
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Začeto spremljanje serije "${seriesName}"!`, 'success');
        allJobs = data.jobs;
        renderJobsList(allJobs);
        closeModal(trackModal);
        updateQuickStats();

        // Immediately trigger first check in background
        fetch('/api/jobs/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: newJob.id, force: false })
        }).catch(() => {});
      } else {
        showToast(`Napaka: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Napaka: ${err.message}`, 'error');
    }
  });

  // Save Global Settings
  globalSettingsForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const selectedProfile = profileSelect ? profileSelect.options[profileSelect.selectedIndex] : null;

    const updated = {
      username: document.getElementById('username').value.trim(),
      password: document.getElementById('password').value,
      profileId: profileSelect?.value ? parseInt(profileSelect.value, 10) : null,
      profileName: selectedProfile ? selectedProfile.textContent.replace(/\s*\(.*\)$/, '') : '',
      bridgeUrl: document.getElementById('bridgeUrl').value.trim(),
      port: parseInt(document.getElementById('port').value, 10),
      streamMode: document.getElementById('streamMode').value || 'proxy',
      jellyfinUrl: document.getElementById('jellyfinUrl').value.trim(),
      jellyfinApiKey: document.getElementById('jellyfinApiKey').value.trim(),
      jellyfinAutoRefresh: document.getElementById('jellyfinAutoRefresh').checked
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      const data = await res.json();
      if (data.success) {
        showToast('Nastavitve shranjene!', 'success');
        globalConfig = data.config;
        closeModal(settingsModal);
        updateQuickStats();
      } else {
        showToast(`Napaka: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Napaka: ${err.message}`, 'error');
    }
  });

  // Test Voyo Auth & Fetch Profiles
  testAuthBtn?.addEventListener('click', async () => {
    testAuthBtn.disabled = true;
    testAuthBtn.textContent = 'Preverjanje...';
    try {
      const res = await fetch('/api/auth/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value.trim(),
          password: document.getElementById('password').value
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Prijava uspešna! Uporabnik: ${data.user?.nickname || data.user?.email}`, 'success');
        if (data.profiles && profileSelect) {
          profileSelect.innerHTML = '<option value="">Izberi profil (samodejno)...</option>';
          for (const prof of data.profiles) {
            const opt = document.createElement('option');
            opt.value = prof.profileId;
            opt.textContent = `${prof.name} (${prof.type || 'profil'})`;
            if (data.activeProfileId === prof.profileId) opt.selected = true;
            profileSelect.appendChild(opt);
          }
        }
      } else {
        showToast(`Prijava ni uspela: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Napaka pri povezavi: ${err.message}`, 'error');
    } finally {
      testAuthBtn.disabled = false;
      testAuthBtn.textContent = '🔐 Preizkusi Voyo Prijavo';
    }
  });

  // Test Jellyfin
  testJellyfinBtn?.addEventListener('click', async () => {
    testJellyfinBtn.disabled = true;
    testJellyfinBtn.textContent = 'Povezujem...';
    try {
      const res = await fetch('/api/jellyfin/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jellyfinUrl: document.getElementById('jellyfinUrl').value.trim(),
          jellyfinApiKey: document.getElementById('jellyfinApiKey').value.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
      } else {
        showToast(`Jellyfin napaka: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Jellyfin napaka: ${err.message}`, 'error');
    } finally {
      testJellyfinBtn.disabled = false;
      testJellyfinBtn.textContent = '🔗 Preizkusi Jellyfin povezavo / Osveži zdaj';
    }
  });

  // Batch Subtitle Convert
  massConvertSubtitlesBtn?.addEventListener('click', async () => {
    massConvertSubtitlesBtn.disabled = true;
    massConvertSubtitlesBtn.textContent = 'Pretvarjam...';
    try {
      const res = await fetch('/api/tools/convert-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Pretvorba zaključena! (${data.stats?.converted} novih SRT)`, 'success');
      } else {
        showToast(`Napaka: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Napaka: ${err.message}`, 'error');
    } finally {
      massConvertSubtitlesBtn.disabled = false;
      massConvertSubtitlesBtn.textContent = '🔄 Pretvori vse VTT v SRT';
    }
  });

  // --------------------------------------------------------------------------
  // File Explorer Implementation
  // --------------------------------------------------------------------------
  async function loadExplorerRoots() {
    if (!explorerRootSelect) return;
    try {
      const res = await fetch('/api/explorer/roots');
      const data = await res.json();
      if (data.success && data.roots) {
        explorerRootSelect.innerHTML = '<option value="">Izberi mapo...</option>';
        data.roots.forEach(root => {
          const opt = document.createElement('option');
          opt.value = root;
          opt.textContent = root;
          explorerRootSelect.appendChild(opt);
        });
        if (data.roots.length > 0) {
          explorerRootSelect.value = data.roots[0];
          loadExplorerPath(data.roots[0]);
        }
      }
    } catch {}
  }

  explorerRootSelect?.addEventListener('change', () => {
    if (explorerRootSelect.value) {
      loadExplorerPath(explorerRootSelect.value);
    }
  });

  explorerRefreshBtn?.addEventListener('click', () => {
    if (currentExplorerPath) {
      loadExplorerPath(currentExplorerPath);
    }
  });

  async function loadExplorerPath(dirPath) {
    try {
      const res = await fetch(`/api/explorer/tree?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      if (data.success) {
        currentExplorerPath = data.currentPath;
        currentExplorerItems = data.items || [];
        renderExplorerBreadcrumbs(currentExplorerPath);
        renderExplorerTable(currentExplorerItems);
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderExplorerBreadcrumbs(fullPath) {
    if (!explorerBreadcrumbs) return;
    const parts = fullPath.split(/[\\/]/).filter(Boolean);
    let cumulative = '';
    const items = parts.map((part, idx) => {
      cumulative += (idx === 0 && fullPath.startsWith('/') ? '/' : '') + part;
      const isLast = idx === parts.length - 1;
      const thisPath = cumulative;
      return isLast
        ? `<span class="breadcrumb-item active">${escapeHtml(part)}</span>`
        : `<span class="breadcrumb-item" data-path="${escapeHtml(thisPath)}">${escapeHtml(part)}</span> / `;
    });

    explorerBreadcrumbs.innerHTML = items.join('');
    explorerBreadcrumbs.querySelectorAll('.breadcrumb-item[data-path]').forEach(el => {
      el.addEventListener('click', (e) => {
        const p = e.currentTarget.getAttribute('data-path');
        if (p) loadExplorerPath(p);
      });
    });
  }

  function renderExplorerTable(items = []) {
    if (!explorerTableBody) return;
    const q = (explorerSearchInput?.value || '').toLowerCase();
    const filtered = items.filter(it => it.name.toLowerCase().includes(q));

    if (explorerItemCount) {
      explorerItemCount.textContent = `${filtered.length} elementov`;
    }

    if (filtered.length === 0) {
      explorerTableBody.innerHTML = '<tr><td colspan="4" style="padding:1.5rem; text-align:center; color:#64748b;">Mapa je prazna ali ni zadetkov.</td></tr>';
      return;
    }

    // Sort folders first, then files
    filtered.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    explorerTableBody.innerHTML = filtered.map(item => {
      const icon = item.isDirectory ? '📁' : (item.name.endsWith('.strm') ? '🎬' : (item.name.endsWith('.nfo') ? '📄' : (item.name.endsWith('.jpg') ? '🖼️' : '📝')));
      const sizeStr = item.isDirectory ? `${item.childCount || 0} el.` : formatFileSize(item.sizeBytes);

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 0.5rem 0.7rem; cursor: ${item.isDirectory ? 'pointer' : 'default'};" class="${item.isDirectory ? 'explorer-item-dir' : 'explorer-item-file'}" data-path="${escapeHtml(item.path)}">
            <span style="margin-right: 0.4rem;">${icon}</span>
            <span style="color: ${item.isDirectory ? '#a78bfa' : '#f3f4f6'}; font-weight: ${item.isDirectory ? '500' : '400'};">${escapeHtml(item.name)}</span>
          </td>
          <td style="padding: 0.5rem 0.7rem; color: #94a3b8; font-size: 0.75rem;">${item.isDirectory ? 'Mapa' : item.name.split('.').pop().toUpperCase()}</td>
          <td style="padding: 0.5rem 0.7rem; color: #94a3b8; font-size: 0.75rem;">${sizeStr}</td>
          <td style="padding: 0.5rem 0.7rem; text-align: right; white-space: nowrap;">
            ${!item.isDirectory && (item.name.endsWith('.nfo') || item.name.endsWith('.strm') || item.name.endsWith('.vtt') || item.name.endsWith('.srt') || item.name.endsWith('.jpg'))
              ? `<button type="button" class="btn btn-outline btn-sm btn-explorer-view" data-path="${escapeHtml(item.path)}" title="Odpri">👁️</button>` : ''}
            ${item.isDirectory && !item.name.toLowerCase().startsWith('season')
              ? `<button type="button" class="btn btn-outline btn-sm btn-explorer-track" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(item.path)}" title="Avtomatsko spremljaj to serijo" style="color:#a78bfa;">🔔</button>` : ''}
            ${item.isDirectory
              ? `<button type="button" class="btn btn-outline btn-sm btn-explorer-refresh-meta" data-path="${escapeHtml(item.path)}" title="Osveži metapodatke">🔄</button>` : ''}
            <button type="button" class="btn btn-outline btn-sm btn-explorer-delete" data-path="${escapeHtml(item.path)}" title="Izbriši" style="color:#ef4444;">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');

    // Directory click
    explorerTableBody.querySelectorAll('.explorer-item-dir').forEach(el => {
      el.addEventListener('click', (e) => {
        const p = e.currentTarget.getAttribute('data-path');
        if (p) loadExplorerPath(p);
      });
    });

    // View file
    explorerTableBody.querySelectorAll('.btn-explorer-view').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const p = e.currentTarget.getAttribute('data-path');
        openFileViewer(p);
      });
    });

    // Track series from explorer
    explorerTableBody.querySelectorAll('.btn-explorer-track').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = e.currentTarget.getAttribute('data-name');
        const p = e.currentTarget.getAttribute('data-path');
        // Clean year if present (e.g. "Otok ljubezni Adria (2026)" -> "Otok ljubezni Adria")
        const cleanName = name.replace(/\s*\(\d{4}\)$/, '');
        const parentDir = p.substring(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')));
        openTrackSeriesModal(cleanName, '', parentDir);
      });
    });

    // Refresh directory metadata
    explorerTableBody.querySelectorAll('.btn-explorer-refresh-meta').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const p = e.currentTarget.getAttribute('data-path');
        showToast('Osvežujem metapodatke...', 'info');
        try {
          const res = await fetch('/api/explorer/refresh-metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: p })
          });
          const data = await res.json();
          if (data.success) {
            showToast(data.message, 'success');
            loadExplorerPath(currentExplorerPath);
          } else {
            showToast(data.message, 'error');
          }
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // Delete item
    explorerTableBody.querySelectorAll('.btn-explorer-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const p = e.currentTarget.getAttribute('data-path');
        if (!confirm(`Ali ste prepričani, da želite izbrisati:\n${p}?`)) return;

        try {
          const res = await fetch(`/api/explorer/item?path=${encodeURIComponent(p)}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            showToast('Element izbrisan', 'success');
            loadExplorerPath(currentExplorerPath);
          } else {
            showToast(`Napaka: ${data.message}`, 'error');
          }
        } catch (err) {
          showToast(`Napaka: ${err.message}`, 'error');
        }
      });
    });
  }

  explorerSearchInput?.addEventListener('input', () => {
    renderExplorerTable(currentExplorerItems);
  });

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = 1;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // Open File Editor / Viewer
  async function openFileViewer(filePath) {
    fileEditorPath.textContent = filePath;
    const isImage = filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.png');

    if (isImage) {
      fileEditorTextareaContainer.style.display = 'none';
      fileImagePreviewContainer.style.display = 'block';
      fileEditorSaveBtn.style.display = 'none';
      fileImagePreview.src = `/api/explorer/file?path=${encodeURIComponent(filePath)}`;
    } else {
      fileEditorTextareaContainer.style.display = 'block';
      fileImagePreviewContainer.style.display = 'none';
      fileEditorSaveBtn.style.display = 'inline-block';

      try {
        const res = await fetch(`/api/explorer/file?path=${encodeURIComponent(filePath)}`);
        const data = await res.json();
        fileEditorContent.value = data.content || '';
      } catch (err) {
        fileEditorContent.value = 'Napaka pri nalaganju vsebine: ' + err.message;
      }
    }

    openModal(fileEditorModal);
  }

  fileEditorCloseBtn?.addEventListener('click', () => closeModal(fileEditorModal));
  fileEditorCancelBtn?.addEventListener('click', () => closeModal(fileEditorModal));

  fileEditorSaveBtn?.addEventListener('click', async () => {
    const filePath = fileEditorPath.textContent;
    const content = fileEditorContent.value;
    try {
      const res = await fetch('/api/explorer/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Datoteka uspešno shranjena!', 'success');
        closeModal(fileEditorModal);
      } else {
        showToast(`Napaka: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Napaka: ${err.message}`, 'error');
    }
  });

  // --------------------------------------------------------------------------
  // Catalog Preview Modal & Selective Item Sync
  // --------------------------------------------------------------------------
  let currentPreviewItems = [];
  let currentPreviewTab = 'all'; // 'all' | 'shows' | 'movies'
  let previewSortColumn = 'year'; // default sort by year descending
  let previewSortDirection = 'desc'; // 'asc' | 'desc'
  let activePreviewFilters = null; // Filter context passed from Job modal or custom

  function updateSortHeaderIcons() {
    const iconTitle = document.getElementById('sort-icon-title');
    const iconType = document.getElementById('sort-icon-type');
    const iconYear = document.getElementById('sort-icon-year');

    if (iconTitle) iconTitle.textContent = previewSortColumn === 'title' ? (previewSortDirection === 'asc' ? '▲' : '▼') : '↕';
    if (iconType) iconType.textContent = previewSortColumn === 'type' ? (previewSortDirection === 'asc' ? '▲' : '▼') : '↕';
    if (iconYear) iconYear.textContent = previewSortColumn === 'year' ? (previewSortDirection === 'asc' ? '▲' : '▼') : '↕';

    if (iconTitle) iconTitle.style.color = previewSortColumn === 'title' ? '#a78bfa' : '#64748b';
    if (iconType) iconType.style.color = previewSortColumn === 'type' ? '#a78bfa' : '#64748b';
    if (iconYear) iconYear.style.color = previewSortColumn === 'year' ? '#a78bfa' : '#64748b';
  }

  function handleSortClick(colName) {
    if (previewSortColumn === colName) {
      previewSortDirection = previewSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      previewSortColumn = colName;
      // Default year to desc, others to asc
      previewSortDirection = colName === 'year' ? 'desc' : 'asc';
    }
    updateSortHeaderIcons();
    renderPreviewModal(currentPreviewItems);
  }

  document.getElementById('th-sort-title')?.addEventListener('click', () => handleSortClick('title'));
  document.getElementById('th-sort-type')?.addEventListener('click', () => handleSortClick('type'));
  document.getElementById('th-sort-year')?.addEventListener('click', () => handleSortClick('year'));

  async function openCatalogPreview(triggerBtn, forceRefresh = false) {
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.dataset.origText = triggerBtn.textContent;
      triggerBtn.textContent = 'Nalaganje...';
    }

    // Determine filter context and tab based on caller
    const jobMediaTypeSelect = document.getElementById('job-media-type');
    const jobNameInput = document.getElementById('job-name');
    const jobTypeVal = jobMediaTypeSelect?.value || '';
    const jobNameVal = (jobNameInput?.value || '').toLowerCase();

    if (triggerBtn === jobPreviewBtn) {
      // Capture filters from current Job modal inputs
      const minYearVal = parseInt(document.getElementById('job-min-year')?.value, 10);
      const minRatingVal = parseFloat(document.getElementById('job-min-rating')?.value);
      const titleFilterVal = document.getElementById('job-title-filter')?.value?.trim() || '';
      const selectedGenreInputs = Array.from(document.querySelectorAll('#genre-checkbox-container input[name="selectedGenres"]:checked'));
      const selectedGenres = selectedGenreInputs.map(cb => cb.value.trim());

      activePreviewFilters = {
        minYear: !isNaN(minYearVal) ? minYearVal : null,
        minRating: !isNaN(minRatingVal) ? minRatingVal : null,
        titleFilter: titleFilterVal || null,
        genres: selectedGenres
      };

      if (jobTypeVal === 'movies' || jobNameVal.includes('film')) {
        currentPreviewTab = 'movies';
      } else if (jobTypeVal === 'shows' || jobNameVal.includes('serij')) {
        currentPreviewTab = 'shows';
      } else {
        currentPreviewTab = 'all';
      }
    } else if (!forceRefresh) {
      currentPreviewTab = 'all';
      activePreviewFilters = null;
    }

    updatePreviewTabButtons();

    try {
      const res = await fetch('/api/sync/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: !!forceRefresh })
      });
      const data = await res.json();
      if (data.success && data.items) {
        currentPreviewItems = data.items.map(it => ({
          ...it,
          _selected: false
        }));

        // Update counts
        const totalAll = currentPreviewItems.length;
        const totalShows = currentPreviewItems.filter(i => i.isSeries).length;
        const totalMovies = currentPreviewItems.filter(i => !i.isSeries).length;

        if (previewCountAll) previewCountAll.textContent = totalAll;
        if (previewCountShows) previewCountShows.textContent = totalShows;
        if (previewCountMovies) previewCountMovies.textContent = totalMovies;

        updateSortHeaderIcons();
        renderPreviewModal(currentPreviewItems);
        updateSelectedButtonState();
        openModal(previewModal);
      } else {
        showToast(`Predogled ni uspel: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Napaka: ${err.message}`, 'error');
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = triggerBtn.dataset.origText || '🔍 Predogled Vsebin';
      }
    }
  }

  function updatePreviewTabButtons() {
    if (previewTabAll) {
      previewTabAll.className = currentPreviewTab === 'all' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
    }
    if (previewTabShows) {
      previewTabShows.className = currentPreviewTab === 'shows' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
    }
    if (previewTabMovies) {
      previewTabMovies.className = currentPreviewTab === 'movies' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
    }
  }

  previewTabAll?.addEventListener('click', () => {
    currentPreviewTab = 'all';
    updatePreviewTabButtons();
    renderPreviewModal(currentPreviewItems);
  });

  previewTabShows?.addEventListener('click', () => {
    currentPreviewTab = 'shows';
    updatePreviewTabButtons();
    renderPreviewModal(currentPreviewItems);
  });

  previewTabMovies?.addEventListener('click', () => {
    currentPreviewTab = 'movies';
    updatePreviewTabButtons();
    renderPreviewModal(currentPreviewItems);
  });

  previewRefreshBtn?.addEventListener('click', () => {
    openCatalogPreview(previewRefreshBtn, true);
  });

  jobPreviewBtn?.addEventListener('click', () => openCatalogPreview(jobPreviewBtn));
  btnQuickPreview?.addEventListener('click', () => openCatalogPreview(btnQuickPreview));

  function updateSelectedButtonState() {
    const selectedCount = currentPreviewItems.filter(it => it._selected).length;
    if (previewSelectedCounterText) {
      previewSelectedCounterText.textContent = `Izbrano: ${selectedCount} ${selectedCount === 1 ? 'vsebina' : (selectedCount === 2 ? 'vsebini' : 'vsebin')}`;
    }
    if (previewSyncSelectedBtn) {
      previewSyncSelectedBtn.textContent = `▶️ Prenesi izbrano (${selectedCount})`;
      previewSyncSelectedBtn.disabled = selectedCount === 0;
    }
  }

  function clearActivePreviewFilters() {
    activePreviewFilters = null;
    renderPreviewModal(currentPreviewItems);
  }

  function renderPreviewModal(items = []) {
    if (!previewItemsBody) return;

    // Filter by active tab (All vs Shows vs Movies)
    let tabFiltered = items;
    if (currentPreviewTab === 'shows') tabFiltered = items.filter(it => it.isSeries);
    else if (currentPreviewTab === 'movies') tabFiltered = items.filter(it => !it.isSeries);

    // Apply job filters if opened from Job Modal
    if (activePreviewFilters) {
      if (activePreviewFilters.minYear) {
        tabFiltered = tabFiltered.filter(it => it.year && parseInt(it.year, 10) >= activePreviewFilters.minYear);
      }
      if (activePreviewFilters.titleFilter) {
        const tf = activePreviewFilters.titleFilter.toLowerCase();
        tabFiltered = tabFiltered.filter(it => {
          const t = (it.title || it.name || '').toLowerCase();
          const u = (it.url || '').toLowerCase();
          return t.includes(tf) || u.includes(tf);
        });
      }
      if (activePreviewFilters.genres && activePreviewFilters.genres.length > 0) {
        const requiredGenres = activePreviewFilters.genres.map(g => g.toLowerCase());
        tabFiltered = tabFiltered.filter(it => {
          if (!it.genres || it.genres.length === 0) {
            // Check if title or url matches any genre keyword
            const txt = ((it.title || '') + ' ' + (it.url || '')).toLowerCase();
            return requiredGenres.some(g => txt.includes(g));
          }
          return it.genres.some(g => requiredGenres.includes(g.toLowerCase()));
        });
      }
    }

    const q = (previewSearchInput?.value || '').toLowerCase().trim();
    let filtered = tabFiltered.filter(it => (it.title || it.name || '').toLowerCase().includes(q));

    // Sort items according to active sort column and direction
    filtered.sort((a, b) => {
      let valA, valB;
      if (previewSortColumn === 'year') {
        valA = a.year ? parseInt(a.year, 10) : 0;
        valB = b.year ? parseInt(b.year, 10) : 0;
      } else if (previewSortColumn === 'type') {
        valA = a.isSeries ? 'Serija' : 'Film';
        valB = b.isSeries ? 'Serija' : 'Film';
      } else {
        valA = (a.title || a.name || '').toLowerCase();
        valB = (b.title || b.name || '').toLowerCase();
      }

      if (typeof valA === 'number' && typeof valB === 'number') {
        return previewSortDirection === 'asc' ? (valA - valB) : (valB - valA);
      }
      const cmp = String(valA).localeCompare(String(valB), 'sl');
      return previewSortDirection === 'asc' ? cmp : -cmp;
    });

    const tabLabel = currentPreviewTab === 'shows' ? 'serij' : (currentPreviewTab === 'movies' ? 'filmov' : 'vsebin');
    let summaryHtml = `<span style="color:#a78bfa; font-weight:600;">Skupaj ${tabLabel}: ${tabFiltered.length} (Prikazano: ${Math.min(filtered.length, 300)} od ${filtered.length})</span>`;

    if (activePreviewFilters && (activePreviewFilters.minYear || activePreviewFilters.titleFilter || (activePreviewFilters.genres && activePreviewFilters.genres.length > 0))) {
      const pills = [];
      if (activePreviewFilters.minYear) pills.push(`Leto &ge; ${activePreviewFilters.minYear}`);
      if (activePreviewFilters.titleFilter) pills.push(`Filter: "${escapeHtml(activePreviewFilters.titleFilter)}"`);
      if (activePreviewFilters.genres && activePreviewFilters.genres.length > 0) pills.push(`Žanri: ${activePreviewFilters.genres.join(', ')}`);
      
      summaryHtml += `
        <div style="margin-top: 0.35rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <span style="font-size:0.75rem; color:#94a3b8;">Filtri opravila:</span>
          ${pills.map(p => `<span style="font-size:0.75rem; background:#3b82f620; color:#60a5fa; border:1px solid #3b82f640; border-radius:4px; padding:0.1rem 0.4rem;">${p}</span>`).join('')}
          <button type="button" class="btn btn-sm btn-outline" id="btn-clear-preview-filters" style="font-size:0.7rem; padding:0.1rem 0.4rem; color:#cbd5e1;">✕ Počisti filtre</button>
        </div>
      `;
    }

    previewSummaryTags.innerHTML = summaryHtml;
    document.getElementById('btn-clear-preview-filters')?.addEventListener('click', clearActivePreviewFilters);

    if (filtered.length === 0) {
      previewItemsBody.innerHTML = '<tr><td colspan="5" style="padding:1.5rem; text-align:center; color:#64748b;">Ni zadetkov za iskani filter v tem zavihku.</td></tr>';
      return;
    }

    // Render up to 300 items for silky UI performance
    const renderList = filtered.slice(0, 300);

    previewItemsBody.innerHTML = renderList.map(it => {
      const typeLabel = it.isSeries ? '📺 Serija' : '🎬 Film';
      const yearStr = it.year || '-';
      const isChecked = !!it._selected;
      const safeUrl = escapeHtml(it.url || '');

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);" data-url="${safeUrl}">
          <td style="padding: 0.6rem 0.8rem; text-align: center;">
            <input type="checkbox" class="preview-item-checkbox" data-url="${safeUrl}" ${isChecked ? 'checked' : ''} style="cursor:pointer;" />
          </td>
          <td style="padding: 0.6rem 0.8rem; color: #f3f4f6; font-weight: 500;">${escapeHtml(it.title || it.name)}</td>
          <td style="padding: 0.6rem 0.8rem; color: #94a3b8;">${typeLabel}</td>
          <td style="padding: 0.6rem 0.8rem; color: #94a3b8;">${yearStr}</td>
          <td style="padding: 0.6rem 0.8rem; text-align: right; white-space: nowrap;">
            ${it.isSeries ? `<button type="button" class="btn btn-outline btn-sm btn-track-single" data-name="${escapeHtml(it.title || it.name)}" data-url="${safeUrl}" title="Samodejno spremljaj to serijo" style="margin-right:0.35rem; color:#a78bfa;">🔔 Spremljaj</button>` : ''}
            <button type="button" class="btn btn-primary btn-sm btn-sync-single" data-url="${safeUrl}" title="Prenesi samo to vsebino">▶️ Prenesi</button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach row checkbox handlers
    previewItemsBody.querySelectorAll('.preview-item-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const url = e.target.getAttribute('data-url');
        const target = currentPreviewItems.find(it => it.url === url);
        if (target) {
          target._selected = e.target.checked;
        }
        updateSelectedButtonState();
      });
    });

    // Attach track series button
    previewItemsBody.querySelectorAll('.btn-track-single').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const name = e.currentTarget.getAttribute('data-name');
        const url = e.currentTarget.getAttribute('data-url');
        openTrackSeriesModal(name, url);
      });
    });

    // Attach single item direct download buttons
    previewItemsBody.querySelectorAll('.btn-sync-single').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const url = e.currentTarget.getAttribute('data-url');
        const target = currentPreviewItems.find(it => it.url === url);
        if (target) {
          await triggerSyncItems([target], `"${target.title || target.name}"`);
        }
      });
    });
  }

  async function triggerSyncItems(itemsToSync = [], label = '') {
    if (!itemsToSync || itemsToSync.length === 0) {
      showToast('Izberite vsaj eno vsebino!', 'error');
      return;
    }

    const targetDir = document.getElementById('job-target-dir')?.value || '';

    showToast(`🚀 Začenjam prenos za ${label}...`, 'info');
    if (previewSyncSelectedBtn) {
      previewSyncSelectedBtn.disabled = true;
      previewSyncSelectedBtn.textContent = 'Prenašam...';
    }

    try {
      const res = await fetch('/api/sync/run-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: itemsToSync,
          targetDir: targetDir || undefined,
          force: false
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Prenos zagnan v ozadju! Spremljajte potek v dnevnikih.`, 'success');
        closeModal(previewModal);
        if (jobModal) closeModal(jobModal);
        // Open sync logs tab so user can watch progress
        if (logsModal) {
          openModal(logsModal);
          switchLogsTab('sync');
        }
      } else {
        showToast(`Napaka pri prenosu: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Napaka: ${err.message}`, 'error');
    } finally {
      updateSelectedButtonState();
    }
  }

  previewSyncSelectedBtn?.addEventListener('click', async () => {
    const selected = currentPreviewItems.filter(it => it._selected);
    if (selected.length === 0) {
      showToast('Označite vsaj eno vsebino s kljukico!', 'error');
      return;
    }
    await triggerSyncItems(selected, `${selected.length} izbranih vsebin`);
  });

  previewSearchInput?.addEventListener('input', () => renderPreviewModal(currentPreviewItems));

  previewSelectAllBtn?.addEventListener('click', () => {
    let tabFiltered = currentPreviewItems;
    if (currentPreviewTab === 'shows') tabFiltered = currentPreviewItems.filter(it => it.isSeries);
    else if (currentPreviewTab === 'movies') tabFiltered = currentPreviewItems.filter(it => !it.isSeries);

    const q = (previewSearchInput?.value || '').toLowerCase().trim();
    tabFiltered.forEach(it => {
      if (!q || (it.title || it.name || '').toLowerCase().includes(q)) {
        it._selected = true;
      }
    });
    renderPreviewModal(currentPreviewItems);
    updateSelectedButtonState();
  });

  previewDeselectAllBtn?.addEventListener('click', () => {
    let tabFiltered = currentPreviewItems;
    if (currentPreviewTab === 'shows') tabFiltered = currentPreviewItems.filter(it => it.isSeries);
    else if (currentPreviewTab === 'movies') tabFiltered = currentPreviewItems.filter(it => !it.isSeries);

    tabFiltered.forEach(it => it._selected = false);
    renderPreviewModal(currentPreviewItems);
    updateSelectedButtonState();
  });

  previewCloseBtn?.addEventListener('click', () => closeModal(previewModal));
  previewCancelBtn?.addEventListener('click', () => closeModal(previewModal));

  // Render History Audit List
  function renderHistory(history = []) {
    if (!historyList) return;
    if (history.length === 0) {
      historyList.innerHTML = '<div style="text-align:center; padding: 2rem; color: var(--text-muted); font-size: 0.85rem;">Ni še zabeleženih zagonov opravil.</div>';
      return;
    }

    historyList.innerHTML = history.map(entry => {
      const isSuccess = entry.status === 'completed';
      const isAuto = entry.trigger === 'auto';

      return `
        <div style="background: #141822; border: 1px solid var(--card-border); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 0.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.825rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <strong style="color: #f3f4f6; font-size: 0.9rem;">${escapeHtml(entry.jobName || 'Opravilo')}</strong>
              <span style="font-size: 0.68rem; font-weight: 700; padding: 0.15rem 0.4rem; border-radius: 4px; background: ${isAuto ? '#3b82f620' : '#8b5cf620'}; color: ${isAuto ? '#60a5fa' : '#c084fc'}; border: 1px solid ${isAuto ? '#3b82f640' : '#8b5cf640'};">
                ${isAuto ? '⏰ SAMODEJNO' : '👤 ROČNO'}
              </span>
              <strong style="color: ${isSuccess ? '#10b981' : '#ef4444'};">${isSuccess ? '✅ Uspešno' : '❌ Napaka'}</strong>
              <span style="color: var(--text-muted); font-size: 0.75rem;">(${entry.timestamp})</span>
            </div>
            <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">${entry.durationSec ? entry.durationSec + 's' : ''}</span>
          </div>
          <div style="font-size: 0.785rem; color: #cbd5e1; margin-top: 0.35rem;">
            ${escapeHtml(entry.summary || '')}
          </div>
        </div>
      `;
    }).join('');
  }

  // Polling loop for live status & logs
  setInterval(async () => {
    try {
      const [statusRes, logsRes, histRes] = await Promise.all([
        fetch('/api/sync/status'),
        fetch('/api/logs'),
        fetch('/api/history')
      ]);

      const statusData = await statusRes.json();
      const logsData = await logsRes.json();
      const histData = await histRes.json();

      if (logsData.logs && logOutput) {
        logOutput.textContent = logsData.logs.join('\n');
      }
      if (logsData.bridgeLogs && bridgeLogOutput) {
        bridgeLogOutput.textContent = logsData.bridgeLogs.join('\n');
      }
      if (histData.history) {
        renderHistory(histData.history);
      }

      const prevIsSyncing = isSyncing;
      isSyncing = !!statusData.isSyncing;
      runningJobId = statusData.currentJobId;
      if (syncRunningTag) {
        syncRunningTag.style.display = isSyncing ? 'inline-block' : 'none';
      }

      if (prevIsSyncing !== isSyncing) {
        const jobsRes = await fetch('/api/jobs');
        const jData = await jobsRes.json();
        if (jData.jobs) {
          allJobs = jData.jobs;
          renderJobsList(allJobs);
        }
      }

      updateQuickStats();
    } catch {}
  }, 2000);

  loadInitialData();
});
