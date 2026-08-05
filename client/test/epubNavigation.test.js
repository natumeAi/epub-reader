import test from 'node:test';
import assert from 'node:assert/strict';
import {
  displayRenditionTarget,
  navigateBasicRenditionPage,
  stabilizeContinuousManagerLayout,
} from '../src/utils/epubNavigation.js';

const PAGE_WIDTH = 564;
const frameEnvironment = {
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  cancelAnimationFrame: clearTimeout,
};

function waitForFrame() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

function displayedPage(view, scrollLeft) {
  return Math.floor((scrollLeft - view.element.offsetLeft) / PAGE_WIDTH) + 1;
}

function createContinuousManager({ compensateAbove = false } = {}) {
  const container = { scrollLeft: 3384 };
  const precedingView = {
    element: { offsetLeft: 0, offsetWidth: 2256 },
    section: { index: 38 },
  };
  const illustrationView = {
    element: { offsetLeft: 2256, offsetWidth: PAGE_WIDTH },
    section: { index: 39 },
  };
  const textView = {
    element: { offsetLeft: 2820, offsetWidth: 5640 },
    section: { index: 40 },
  };
  const views = [precedingView, illustrationView, textView];
  const scrollCalls = [];
  const manager = {
    container,
    name: 'continuous',
    scrollTo(left) {
      scrollCalls.push(left);
      container.scrollLeft = left;
    },
    settings: { axis: 'horizontal', direction: 'ltr' },
    views: { all: () => views },
    erase(view, above) {
      const removedLeft = view.element.offsetLeft;
      const removedWidth = view.element.offsetWidth;
      views.splice(views.indexOf(view), 1);
      views.forEach((remainingView) => {
        if (remainingView.element.offsetLeft > removedLeft) {
          remainingView.element.offsetLeft -= removedWidth;
        }
      });
      if (compensateAbove && above) {
        this.scrollTo(container.scrollLeft - removedWidth, 0, true);
      }
    },
  };

  return {
    container,
    illustrationView,
    manager,
    precedingView,
    scrollCalls,
    textView,
  };
}

function createBackwardPagingRendition(pageTotals, startIndex = 0) {
  const sections = pageTotals.map((pages, offset) => ({
    index: startIndex + offset,
    pages,
  }));
  sections.forEach((section, offset) => {
    section.prev = () => sections[offset - 1] || null;
  });

  const container = { scrollLeft: (sections.at(-1).pages - 1) * PAGE_WIDTH };
  const loadedSections = [sections.at(-1)];
  let managerQueue = Promise.resolve();
  const manager = {
    container,
    layout: { delta: PAGE_WIDTH },
    name: 'continuous',
    q: {
      enqueue(task) {
        managerQueue = managerQueue.then(() => task.call(manager));
        return managerQueue;
      },
      run: () => managerQueue,
    },
    settings: { axis: 'horizontal', direction: 'ltr' },
    views: { first: () => ({ section: loadedSections[0] }) },
    check() {
      if (container.scrollLeft > 0) return;
      const previousSection = loadedSections[0].prev();
      if (!previousSection) return;
      loadedSections.unshift(previousSection);
      container.scrollLeft += previousSection.pages * PAGE_WIDTH;
    },
  };

  const currentLocation = () => {
    let pageOffset = Math.floor(container.scrollLeft / PAGE_WIDTH);
    for (const section of loadedSections) {
      if (pageOffset < section.pages) {
        return {
          start: {
            displayed: { page: pageOffset + 1, total: section.pages },
            index: section.index,
          },
        };
      }
      pageOffset -= section.pages;
    }
    throw new Error('Scroll position is outside loaded sections');
  };
  const rendition = {
    currentLocation,
    manager,
    prev() {
      container.scrollLeft = Math.max(0, container.scrollLeft - PAGE_WIDTH);
      manager.q.enqueue(manager.check);
    },
  };

  return {
    aggregatePage() {
      const location = currentLocation();
      const sectionOffset = location.start.index - startIndex;
      return pageTotals.slice(0, sectionOffset).reduce((sum, pages) => sum + pages, 0) +
        location.start.displayed.page;
    },
    manager,
    rendition,
    totalPages: pageTotals.reduce((sum, pages) => sum + pages, 0),
  };
}

test('keeps the displayed page anchored when epub.js erases an earlier view without compensating', async () => {
  const {
    container,
    manager,
    precedingView,
    textView,
  } = createContinuousManager();
  const cleanup = stabilizeContinuousManagerLayout({ manager }, frameEnvironment);

  assert.equal(displayedPage(textView, container.scrollLeft), 2);
  manager.erase(precedingView);
  await waitForFrame();

  assert.equal(textView.element.offsetLeft, PAGE_WIDTH);
  assert.equal(container.scrollLeft, PAGE_WIDTH * 2);
  assert.equal(displayedPage(textView, container.scrollLeft), 2);
  cleanup();
});

test('does not double-compensate when epub.js already anchors an erased earlier view', async () => {
  const {
    container,
    manager,
    precedingView,
    scrollCalls,
    textView,
  } = createContinuousManager({ compensateAbove: true });
  const cleanup = stabilizeContinuousManagerLayout({ manager }, frameEnvironment);

  manager.erase(precedingView, [precedingView]);
  await waitForFrame();

  assert.equal(container.scrollLeft, PAGE_WIDTH * 2);
  assert.equal(displayedPage(textView, container.scrollLeft), 2);
  assert.deepEqual(scrollCalls, [PAGE_WIDTH * 2]);
  cleanup();
});

test('does not double-compensate when layout anchors an erased view asynchronously', async () => {
  const removedWidth = PAGE_WIDTH * 10;
  const container = { scrollLeft: removedWidth + (PAGE_WIDTH * 15) };
  const precedingView = {
    element: { offsetLeft: 0, offsetWidth: removedWidth },
    section: { index: 35 },
  };
  const textView = {
    element: { offsetLeft: removedWidth, offsetWidth: PAGE_WIDTH * 16 },
    section: { index: 36 },
  };
  const views = [precedingView, textView];
  const manager = {
    container,
    name: 'continuous',
    scrollTo(left) {
      container.scrollLeft = left;
    },
    settings: { axis: 'horizontal', direction: 'ltr' },
    views: { all: () => views },
    erase() {
      textView.element.offsetLeft -= removedWidth;
      views.shift();
      setTimeout(() => {
        container.scrollLeft -= removedWidth;
      }, 0);
    },
  };
  const cleanup = stabilizeContinuousManagerLayout({ manager }, frameEnvironment);

  manager.erase(precedingView);
  await waitForFrame();

  assert.equal(displayedPage(textView, container.scrollLeft), 16);
  cleanup();
});

test('anchors one visible page across multiple erases in the same frame', async () => {
  const container = { scrollLeft: PAGE_WIDTH * 4 };
  const firstView = {
    element: { offsetLeft: 0, offsetWidth: PAGE_WIDTH },
    section: { index: 35 },
  };
  const secondView = {
    element: { offsetLeft: PAGE_WIDTH, offsetWidth: PAGE_WIDTH },
    section: { index: 36 },
  };
  const textView = {
    element: { offsetLeft: PAGE_WIDTH * 2, offsetWidth: PAGE_WIDTH * 8 },
    section: { index: 37 },
  };
  const views = [firstView, secondView, textView];
  const scrollCalls = [];
  const manager = {
    container,
    name: 'continuous',
    scrollTo(left) {
      scrollCalls.push(left);
      container.scrollLeft = left;
    },
    settings: { axis: 'horizontal', direction: 'ltr' },
    views: { all: () => views },
    erase(view) {
      const removedLeft = view.element.offsetLeft;
      const removedWidth = view.element.offsetWidth;
      views.splice(views.indexOf(view), 1);
      views.forEach((remainingView) => {
        if (remainingView.element.offsetLeft > removedLeft) {
          remainingView.element.offsetLeft -= removedWidth;
        }
      });
    },
  };
  const cleanup = stabilizeContinuousManagerLayout({ manager }, frameEnvironment);

  assert.equal(displayedPage(textView, container.scrollLeft), 3);
  manager.erase(firstView);
  manager.erase(secondView);
  await waitForFrame();

  assert.equal(displayedPage(textView, container.scrollLeft), 3);
  assert.deepEqual(scrollCalls, [PAGE_WIDTH * 2]);
  cleanup();
});

test('prevents native scroll anchoring from double-compensating a prepended view', () => {
  const container = {
    scrollLeft: 0,
    style: { overflowAnchor: '' },
  };
  const targetView = {
    element: { offsetLeft: 0, offsetWidth: PAGE_WIDTH },
    section: { index: 39 },
  };
  const views = [targetView];
  const manager = {
    container,
    name: 'continuous',
    settings: { axis: 'horizontal', direction: 'ltr' },
    views: { all: () => views },
    erase() {},
  };
  const cleanup = stabilizeContinuousManagerLayout({ manager }, frameEnvironment);

  const previousView = {
    element: { offsetLeft: 0, offsetWidth: PAGE_WIDTH * 4 },
    section: { index: 38 },
  };
  views.unshift(previousView);
  targetView.element.offsetLeft += previousView.element.offsetWidth;
  if (container.style.overflowAnchor !== 'none') {
    // Chromium keeps the target visible when a flex child is inserted before it.
    container.scrollLeft += previousView.element.offsetWidth;
  }
  // epub.js ContinuousViewManager.counter() performs the same compensation.
  container.scrollLeft += previousView.element.offsetWidth;

  assert.equal(container.scrollLeft, PAGE_WIDTH * 4);
  assert.equal(displayedPage(targetView, container.scrollLeft), 1);
  cleanup();
  assert.equal(container.style.overflowAnchor, '');
});

test('crosses from a text publication document to a preceding illustration with one prev turn', async () => {
  const illustrationLocation = {
    start: { displayed: { page: 1, total: 1 }, index: 37 },
  };
  const textLocation = {
    start: { displayed: { page: 1, total: 4 }, index: 38 },
  };
  const illustrationSection = { index: 37 };
  const textSection = {
    index: 38,
    prev: () => illustrationSection,
  };
  const container = { scrollLeft: 0 };
  let currentLocation = textLocation;
  let previousViewLoaded = false;
  let firstView = { section: textSection };
  let managerQueue = Promise.resolve();
  const manager = {
    checkCalls: 0,
    container,
    layout: { delta: PAGE_WIDTH },
    name: 'continuous',
    q: {
      enqueue(task) {
        managerQueue = managerQueue.then(() => task.call(manager));
        return managerQueue;
      },
      run: () => managerQueue,
    },
    settings: { axis: 'horizontal', direction: 'ltr' },
    views: { first: () => firstView },
    async check() {
      this.checkCalls += 1;
      if (previousViewLoaded) return;
      previousViewLoaded = true;
      firstView = { section: illustrationSection };
      container.scrollLeft += PAGE_WIDTH;
    },
  };
  const rendition = {
    currentLocation: () => currentLocation,
    manager,
    prev() {
      container.scrollLeft = Math.max(0, container.scrollLeft - PAGE_WIDTH);
      if (previousViewLoaded && container.scrollLeft === 0) {
        currentLocation = illustrationLocation;
      }
      manager.q.enqueue(manager.check);
    },
  };

  await navigateBasicRenditionPage(rendition, 'prev');

  assert.equal(rendition.currentLocation().start.index, 37);
  assert.equal(manager.checkCalls, 2);
});

test('completes a backward turn when the real epub.js queue settles after its timeout', async () => {
  const previousWindow = globalThis.window;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.window = globalThis;
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);

  try {
    const queueModule = await import('epubjs/lib/utils/queue.js');
    const EpubQueue = queueModule.default.default;
    const illustrationSection = { index: 37 };
    const textSection = {
      index: 38,
      prev: () => illustrationSection,
    };
    const container = { scrollLeft: 0 };
    let currentSection = textSection;
    let currentLocation = {
      start: { displayed: { page: 1, total: 4 }, index: textSection.index },
    };
    const pendingChecks = [];
    const manager = {
      container,
      name: 'continuous',
      settings: { axis: 'horizontal', direction: 'ltr' },
      views: { first: () => ({ section: currentSection }) },
    };
    manager.q = new EpubQueue(manager);
    const rendition = {
      currentLocation: () => currentLocation,
      manager,
      prev() {
        container.scrollLeft = Math.max(0, container.scrollLeft - PAGE_WIDTH);
        if (currentSection === illustrationSection && container.scrollLeft === 0) {
          currentLocation = {
            start: { displayed: { page: 1, total: 1 }, index: illustrationSection.index },
          };
        }
        pendingChecks.push(manager.q.enqueue(async () => {
          if (currentSection === textSection) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            currentSection = illustrationSection;
            container.scrollLeft += PAGE_WIDTH;
          }
        }));
      },
    };

    await navigateBasicRenditionPage(rendition, 'prev', { managerQueueTimeoutMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(currentLocation.start.index, illustrationSection.index);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});

test('moves backward exactly one page across every publication document boundary in chapter 24', async () => {
  // Actual structure: chapter image, long text, illustration, trailing text,
  // followed by the chapter 25 image from which the user navigates backward.
  const paging = createBackwardPagingRendition([1, 16, 1, 4, 1], 35);

  for (let turn = 1; turn < paging.totalPages; turn += 1) {
    await navigateBasicRenditionPage(paging.rendition, 'prev');
    await paging.manager.q.run();
    assert.equal(paging.aggregatePage(), paging.totalPages - turn);
  }
});

test('moves backward one page at a time across mixed illustration and text publication documents', async () => {
  const layouts = [
    [1, 1],
    [4, 1, 3],
    [1, 7, 1, 2, 1],
    [3, 1, 1, 8, 1, 2],
  ];

  for (const pageTotals of layouts) {
    const paging = createBackwardPagingRendition(pageTotals);
    for (let turn = 1; turn < paging.totalPages; turn += 1) {
      await navigateBasicRenditionPage(paging.rendition, 'prev');
      await paging.manager.q.run();
      assert.equal(
        paging.aggregatePage(),
        paging.totalPages - turn,
        `layout ${pageTotals.join(',')} turn ${turn}`,
      );
    }
  }
});

test('preserves every backward page across 100 deterministic mixed-document layouts', async () => {
  let seed = 0x24_19_22;
  const nextValue = () => {
    seed = ((seed * 1664525) + 1013904223) >>> 0;
    return seed;
  };

  for (let layoutIndex = 0; layoutIndex < 100; layoutIndex += 1) {
    const sectionCount = 2 + (nextValue() % 5);
    const pageTotals = Array.from(
      { length: sectionCount },
      () => 1 + (nextValue() % 8),
    );
    const paging = createBackwardPagingRendition(pageTotals);

    for (let turn = 1; turn < paging.totalPages; turn += 1) {
      await navigateBasicRenditionPage(paging.rendition, 'prev');
      await paging.manager.q.run();
      assert.equal(
        paging.aggregatePage(),
        paging.totalPages - turn,
        `layout ${layoutIndex} (${pageTotals.join(',')}) turn ${turn}`,
      );
    }
  }
});

test('keeps an ordinary backward turn locked until continuous manager work settles', async () => {
  let releaseManagerQueue;
  const managerQueue = new Promise((resolve) => {
    releaseManagerQueue = resolve;
  });
  const location = {
    start: { displayed: { page: 2, total: 4 }, index: 38 },
  };
  const rendition = {
    currentLocation: () => location,
    manager: {
      container: { scrollLeft: PAGE_WIDTH },
      name: 'continuous',
      q: { enqueue: () => managerQueue },
      settings: { axis: 'horizontal', direction: 'ltr' },
      views: {
        first: () => ({ section: { index: 38, prev: () => ({ index: 37 }) } }),
      },
    },
    prev() {},
  };

  let settled = false;
  const navigation = navigateBasicRenditionPage(rendition, 'prev', {
    managerQueueTimeoutMs: 100,
  }).then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(settled, false);
  releaseManagerQueue();
  await navigation;
  assert.equal(settled, true);
});

test('waits for pending continuous manager work before a table-of-contents display', async () => {
  let releaseManagerQueue;
  const managerQueue = new Promise((resolve) => {
    releaseManagerQueue = resolve;
  });
  const calls = [];
  const rendition = {
    display(href) {
      calls.push(href);
    },
    manager: {
      name: 'continuous',
      q: { enqueue: () => managerQueue },
    },
  };

  const navigation = displayRenditionTarget(rendition, 'Text/chapter7.xhtml', {
    managerQueueTimeoutMs: 100,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, []);

  releaseManagerQueue();
  assert.equal(await navigation, true);
  assert.deepEqual(calls, ['Text/chapter7.xhtml']);
});

test('keeps a table-of-contents target on its chapter illustration while prepending', async () => {
  const container = {
    scrollLeft: 0,
    style: { overflowAnchor: '' },
  };
  let views = [];
  const manager = {
    container,
    name: 'continuous',
    q: { enqueue: () => Promise.resolve() },
    settings: { axis: 'horizontal', direction: 'ltr' },
    views: { all: () => views },
    erase() {},
  };
  const cleanup = stabilizeContinuousManagerLayout({ manager }, frameEnvironment);
  let location = null;
  const rendition = {
    currentLocation: () => location,
    display(href) {
      assert.equal(href, 'Text/chapter7.xhtml');
      const previousTextView = {
        element: { offsetLeft: 0, offsetWidth: PAGE_WIDTH * 4 },
        section: { index: 38 },
      };
      const chapterIllustrationView = {
        element: { offsetLeft: 0, offsetWidth: PAGE_WIDTH },
        section: { index: 39 },
      };
      const chapterTextView = {
        element: { offsetLeft: PAGE_WIDTH, offsetWidth: PAGE_WIDTH * 10 },
        section: { index: 40 },
      };

      // ContinuousViewManager starts on the target, appends its successor,
      // then prepends the predecessor to fill its preload window.
      chapterIllustrationView.element.offsetLeft += previousTextView.element.offsetWidth;
      chapterTextView.element.offsetLeft += previousTextView.element.offsetWidth;
      views = [previousTextView, chapterIllustrationView, chapterTextView];
      if (container.style.overflowAnchor !== 'none') {
        container.scrollLeft += previousTextView.element.offsetWidth;
      }
      container.scrollLeft += previousTextView.element.offsetWidth;

      const visibleView = views.find((view) => (
        view.element.offsetLeft <= container.scrollLeft &&
        view.element.offsetLeft + view.element.offsetWidth > container.scrollLeft
      ));
      location = {
        start: {
          displayed: {
            page: displayedPage(visibleView, container.scrollLeft),
            total: visibleView.element.offsetWidth / PAGE_WIDTH,
          },
          index: visibleView.section.index,
        },
      };
    },
    manager,
  };

  assert.equal(await displayRenditionTarget(rendition, 'Text/chapter7.xhtml'), true);
  assert.equal(rendition.currentLocation().start.index, 39);
  assert.equal(rendition.currentLocation().start.displayed.page, 1);
  cleanup();
});

test('does not hang when the continuous manager queue fails to settle', async () => {
  const location = {
    start: { displayed: { page: 1, total: 4 }, index: 38 },
  };
  let prevCalls = 0;
  const rendition = {
    currentLocation: () => location,
    manager: {
      name: 'continuous',
      q: { enqueue: () => new Promise(() => {}) },
      settings: { axis: 'horizontal', direction: 'ltr' },
      views: {
        first: () => ({ section: { index: 38, prev: () => ({ index: 37 }) } }),
      },
      container: { scrollLeft: 0 },
    },
    prev() {
      prevCalls += 1;
    },
  };

  await navigateBasicRenditionPage(rendition, 'prev', {
    managerQueueTimeoutMs: 5,
  });

  assert.equal(prevCalls, 1);
});

test('does not complete a timed-out backward turn after it is cancelled', async () => {
  const location = {
    start: { displayed: { page: 1, total: 4 }, index: 38 },
  };
  let active = true;
  let firstSectionIndex = 38;
  let prevCalls = 0;
  let releaseManagerQueue;
  const managerQueue = new Promise((resolve) => {
    releaseManagerQueue = resolve;
  });
  const rendition = {
    currentLocation: () => location,
    manager: {
      container: { scrollLeft: 0 },
      name: 'continuous',
      q: { enqueue: () => managerQueue },
      settings: { axis: 'horizontal', direction: 'ltr' },
      views: {
        first: () => ({
          section: {
            index: firstSectionIndex,
            prev: () => ({ index: firstSectionIndex - 1 }),
          },
        }),
      },
    },
    prev() {
      prevCalls += 1;
    },
  };

  await navigateBasicRenditionPage(rendition, 'prev', {
    managerQueueTimeoutMs: 5,
    shouldContinue: () => active,
  });
  active = false;
  firstSectionIndex = 37;
  releaseManagerQueue();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(prevCalls, 1);
});

test('leaves forward navigation on the single-call path', async () => {
  let nextCalls = 0;
  const rendition = {
    manager: {
      name: 'continuous',
      q: { enqueue: () => new Promise(() => {}) },
      settings: { axis: 'horizontal', direction: 'ltr' },
    },
    next() {
      nextCalls += 1;
    },
  };

  await navigateBasicRenditionPage(rendition, 'next', {
    managerQueueTimeoutMs: 5,
  });

  assert.equal(nextCalls, 1);
});
