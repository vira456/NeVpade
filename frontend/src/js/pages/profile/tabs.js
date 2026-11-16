// Доступні вкладки: клік, стрілки ←/→, Home/End, запам'ятовування у #hash
export function initTabs(root, { onChange } = {}) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));

  function select(index, { focus = false, updateHash = true } = {}) {
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[i].hidden = !active;
    });
    if (focus) tabs[index].focus();
    if (updateHash) history.replaceState(null, '', `#${tabs[index].dataset.tab}`);
    onChange?.(tabs[index].dataset.tab);
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', (e) => {
      const last = tabs.length - 1;
      const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select(next, { focus: true });
    });
  });

  const indexFromHash = () => tabs.findIndex((t) => `#${t.dataset.tab}` === location.hash);

  // Перехід за посиланням на кшталт profile.html#security
  window.addEventListener('hashchange', () => {
    const i = indexFromHash();
    if (i >= 0) select(i, { updateHash: false });
  });

  const fromHash = indexFromHash();
  select(fromHash >= 0 ? fromHash : 0, { updateHash: false });
}
