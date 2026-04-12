export function UpdateApp() {
  const updatePath = `http://${location.host}/update`;

  return (
    <div class="section update-section">
      <h2>Firmware Update (ElegantOTA)</h2>
      <p>
        Use ElegantOTA to upload a new firmware binary. Open the updater in a new tab or use the embedded view below.
      </p>
      <div class="inline-actions">
        <a class="link-button" href={updatePath} target="_blank" rel="noreferrer">
          Open ElegantOTA
        </a>
      </div>
      <div class="ota-frame-wrap">
        <iframe title="ElegantOTA updater" src={updatePath} class="ota-frame" />
      </div>
    </div>
  );
}
