/* Local print renderer; settings are data, never executable uploaded content. */
window.PagedConfig = { auto: false };
window.samplePrintReady = new Promise((resolve, reject) => {
  window.addEventListener('DOMContentLoaded', async () => {
    try {
      const config = JSON.parse(document.body.dataset.printConfig || '{}');
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
      const source = document.getElementById('print-content');
      const pages = document.createElement('div');
      document.body.append(pages);
      await window.PagedPolyfill.preview(source.innerHTML, undefined, pages);
      source.remove();
      for (const page of pages.querySelectorAll('.pagedjs_page')) {
        if (config.letterhead?.image) {
          const background = document.createElement('img');
          background.className = 'sample-letterhead';
          background.alt = 'Sample letterhead';
          background.src = config.letterhead.image;
          page.prepend(background);
          await background.decode();
        }
        const watermark = document.createElement('div');
        watermark.className = 'sample-watermark';
        watermark.textContent = 'SAMPLE';
        page.append(watermark);
      }
      document.body.dataset.printReady = 'true';
      resolve();
      if (config.autoPrint) window.print();
    } catch (error) {
      const message = document.createElement('p');
      message.textContent = 'Print layout could not be prepared: ' + error.message;
      document.body.prepend(message);
      reject(error);
    }
  }, { once: true });
});
window.samplePrintReady.catch(() => {});
