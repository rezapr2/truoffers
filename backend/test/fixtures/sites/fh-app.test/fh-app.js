// The app fetches its store and menu a while after the page arrives, as Foodhub's does.
setTimeout(async () => {
  const [store, menu] = await Promise.all([
    fetch('/api/consumer/store').then((r) => r.json()),
    fetch('/api/consumer/store/9002/menu/foodhub/friday.json').then((r) => r.json()),
  ]);
  document.getElementById('app-root').textContent = `${store.name}: ${menu.data.length} menu section(s) loaded`;
}, 2000);
