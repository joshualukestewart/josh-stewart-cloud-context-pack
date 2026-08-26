import { useEffect, useState } from 'react';
import './carousel.css';

export interface Slide {
  id: string;
  headline: string;
}

const ADVANCE_INTERVAL_MS = 4000;

export function Carousel({ slides }: { slides: Slide[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (slides.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, ADVANCE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [slides.length]);

  return (
    <section className="carousel" aria-roledescription="carousel">
      <div
        className="carousel-track"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {slides.map((slide) => (
          <article key={slide.id} className="carousel-slide">
            <h2>{slide.headline}</h2>
          </article>
        ))}
      </div>
      <ul className="carousel-dots">
        {slides.map((slide, dotIndex) => (
          <li
            key={slide.id}
            className={dotIndex === index ? 'carousel-dot is-active' : 'carousel-dot'}
          />
        ))}
      </ul>
    </section>
  );
}
