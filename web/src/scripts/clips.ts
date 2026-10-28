// Demo clips on the home page (components/DemoClip.astro): muted, in a loop, playing only while on
// screen. With prefers-reduced-motion they stay still, with their controls, for the visitor to play.

let observer: IntersectionObserver | null = null;

function initClips(): void {
  observer?.disconnect();
  observer = null;
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>("video[data-clip]"));
  if (videos.length === 0) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window)) return;
  for (const video of videos) {
    video.controls = false;
    video.muted = true;
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) {
          // Autoplay can still be refused (data saver): then the controls come back.
          video.play().catch(() => {
            video.controls = true;
          });
        } else {
          video.pause();
        }
      }
    },
    { threshold: 0.4 },
  );
  for (const video of videos) observer.observe(video);
}

document.addEventListener("astro:page-load", initClips);
