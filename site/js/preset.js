(() => {
  const root = document.documentElement;
  root.classList.add('gl', 'js');
  const choices = JSON.parse(document.getElementById('presets').textContent);
  const choice = choices[Math.floor(Math.random() * choices.length)];
  document.getElementById('settings').textContent = choice.css;
  root.dataset.ramp = choice.ramp;
  root.dataset.preset = choice.name;
})();
