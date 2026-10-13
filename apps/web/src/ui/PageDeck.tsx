import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

type Native = ReactElement<Record<string, unknown>>;
const groups = new Set(["section", "article", "aside", "div", "fieldset"]);
const headings = new Set(["h3", "h4", "legend", "summary"]);

// Keep inline markup, links and handlers when a long paragraph spans pages.
function inlineParts(node: ReactNode, limit = 80): ReactNode[] {
  if (typeof node === "string") {
    const chars = Array.from(node);
    return Array.from({ length: Math.ceil(chars.length / limit) }, (_, i) =>
      chars.slice(i * limit, (i + 1) * limit).join(""),
    );
  }
  if (typeof node === "number") return [node];
  if (!isValidElement(node)) return node ? [node] : [];
  const element = node as Native;
  if (typeof element.type !== "string" || element.type === "button")
    return [node];
  const parts = Children.toArray(element.props.children as ReactNode).flatMap(
    (child) => inlineParts(child, limit),
  );
  return parts.length
    ? parts.map((part, i) =>
        cloneElement(
          element,
          { key: i, id: i ? undefined : element.props.id },
          part,
        ),
      )
    : [node];
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement(node)
    ? textOf((node as Native).props.children as ReactNode)
    : "";
}

function blocks(node: ReactNode, limit = 80, path = "root"): ReactNode[] {
  if (node === null || node === undefined || typeof node === "boolean")
    return [];
  if (Array.isArray(node))
    return node.flatMap((child, index) =>
      blocks(child, limit, `${path}.${index}`),
    );
  if (typeof node === "string" || typeof node === "number") {
    if (typeof node === "string" && !node.trim()) return [];
    return inlineParts(node, limit).map((part, i) => (
      <p key={`${path}.${i}`}>{part}</p>
    ));
  }
  if (!isValidElement(node)) return [node];
  const element = node as Native;
  const tag = element.type;
  if (typeof tag !== "string") {
    // React fragments are transparent; stateful components remain mounted once.
    return typeof tag === "symbol"
      ? Children.toArray(element.props.children as ReactNode).flatMap(
          (child, index) => blocks(child, limit, `${path}.${index}`),
        )
      : [cloneElement(element, { key: path })];
  }
  const children = Children.toArray(element.props.children as ReactNode);
  if (tag === "p" || tag === "li") {
    const parts = children.flatMap((child) => inlineParts(child, limit));
    // Pack inline fragments into readable paragraphs rather than one line per span.
    const packed: ReactNode[][] = [];
    let textLength = 0;
    for (const part of parts) {
      const length = Array.from(textOf(part)).length;
      if (!packed.length || textLength + length > limit) {
        packed.push([]);
        textLength = 0;
      }
      packed.at(-1)!.push(part);
      textLength += length;
    }
    return packed.length > 1
      ? packed.map((part, i) =>
          cloneElement(
            element,
            { key: `${path}.${i}`, id: i ? undefined : element.props.id },
            part,
          ),
        )
      : [cloneElement(element, { key: path })];
  }
  if (tag === "ul" || tag === "ol") {
    return children.flatMap((child, index) =>
      blocks(child, limit, `${path}.${index}`).map((part, i) =>
        cloneElement(
          element,
          {
            key: `${path}.${index}.${i}`,
            id: index || i ? undefined : element.props.id,
            start:
              tag === "ol"
                ? Number(element.props.start ?? 1) + index
                : undefined,
          },
          part,
        ),
      ),
    );
  }
  if (tag === "details") {
    const summary = children.find(
      (child) => isValidElement(child) && child.type === "summary",
    );
    const title = isValidElement(summary) ? (
      <h4>{(summary as Native).props.children as ReactNode}</h4>
    ) : null;
    return children
      .filter((child) => child !== summary)
      .flatMap((child, index) => blocks(child, limit, `${path}.${index}`))
      .map((part, i) => (
        <section
          key={isValidElement(part) ? part.key : `${path}.${i}`}
          className="page-detail"
        >
          {title}
          {part}
        </section>
      ));
  }
  if (
    groups.has(tag) &&
    element.props.role !== "row" &&
    element.props.role !== "table"
  ) {
    // Composite titles (for example an advisor portrait and identity) repeat
    // together so a paginated explanation retains its speaker on every page.
    const title = children.find(
      (child) =>
        isValidElement(child) &&
        (headings.has(String(child.type)) ||
          (child as Native).props["data-page-title"] === true),
    );
    const content = children.filter((child) => child !== title);
    if (!content.length) return [cloneElement(element, { key: path })];
    const pieces = content.flatMap((child, index) =>
      blocks(child, limit, `${path}.${index}`),
    );
    return pieces.map((part, i) => {
      const titleId = isValidElement(title)
        ? (title as Native).props.id
        : undefined;
      const fragmentTitleId = titleId
        ? `${titleId}${i ? `-part-${i}` : ""}`
        : undefined;
      const repeatedTitle = isValidElement(title)
        ? cloneElement(title as Native, { id: fragmentTitleId })
        : title;
      return cloneElement(
        element,
        {
          key: isValidElement(part) ? part.key : `${path}.${i}`,
          id: i ? undefined : element.props.id,
          "aria-labelledby":
            element.props["aria-labelledby"] && fragmentTitleId
              ? fragmentTitleId
              : undefined,
          "aria-label":
            element.props["aria-label"] ??
            (element.props["aria-labelledby"] && !fragmentTitleId
              ? textOf(title)
              : undefined),
        },
        repeatedTitle,
        part,
      );
    });
  }
  return [cloneElement(element, { key: path })];
}

export type PageDeckCategory = {
  id: string;
  label: string;
  content: ReactNode;
};

export function PageDeck({
  label,
  children,
  categories,
  actions,
}: {
  label: string;
  children?: ReactNode;
  categories?: readonly PageDeckCategory[];
  actions?: ReactNode;
}) {
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [layout, setLayout] = useState<{
    pages: number[][];
    categoryIds: (string | undefined)[];
    firstItemKeys: (string | number | undefined)[];
  }>({ pages: [], categoryIds: [], firstItemKeys: [] });
  const { pages } = layout;
  const [expanded, setExpanded] = useState(
    () => typeof ResizeObserver === "undefined",
  );
  const [textLimit, setTextLimit] = useState(80);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string>();
  const categoryItems = categories
    ?.map((category) => ({
      ...category,
      items: blocks(category.content, textLimit, `category.${category.id}`),
    }))
    .filter((category) => category.items.length > 0);
  const items = categoryItems
    ? categoryItems.flatMap((category) => category.items)
    : blocks(children, textLimit);
  const itemCategoryIds = categoryItems?.flatMap((category) =>
    category.items.map(() => category.id),
  );
  const itemKeys = items.map((item, index) =>
    isValidElement(item) ? (item.key ?? index) : index,
  );
  const pageCount = Math.max(1, pages.length);
  const current = Math.min(page, pageCount - 1);
  const pageCategoryId = layout.categoryIds[current] ?? itemCategoryIds?.[0];
  const currentCategory =
    categoryItems?.find(
      (category) =>
        category.id ===
        (expanded ? (expandedCategoryId ?? pageCategoryId) : pageCategoryId),
    ) ?? categoryItems?.[0];
  const categoryPages = layout.categoryIds
    .map((categoryId, index) => ({ index, categoryId }))
    .filter((entry) => entry.categoryId === currentCategory?.id);
  const categoryPage = Math.max(
    0,
    categoryPages.findIndex((entry) => entry.index === current),
  );
  const statusId = `${id}-status`;
  const status = expanded
    ? `${currentCategory ? `${currentCategory.label} · ` : ""}全文を表示しています`
    : currentCategory
      ? `${currentCategory.label} · ${categoryPage + 1} / ${Math.max(1, categoryPages.length)}ページ`
      : `${current + 1} / ${pageCount}ページ`;

  useLayoutEffect(() => {
    const container = content.current;
    if (!container) return;
    const measure = () => {
      const available = container.clientHeight;
      const nodes = [
        ...container.querySelectorAll<HTMLElement>(":scope > [data-page-item]"),
      ];
      const fontSize = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      const enlarge =
        fontSize >= 24 || (window.visualViewport?.scale ?? 1) >= 1.5;
      // A zero-height measurement can be transient while a bounded screen
      // lays out its controls. Keep the previous layout until it is measurable;
      // expanding here would change its own height and oscillate every commit.
      setExpanded((previous) => enlarge || (available <= 0 ? previous : false));
      if (enlarge || available <= 0) return;
      const charactersPerLine = Math.max(
        12,
        Math.floor(container.clientWidth / 18),
      );
      const nextLimit = Math.max(
        20,
        Math.min(80, Math.floor((available - 64) / 23) * charactersPerLine),
      );
      if (nextLimit !== textLimit) {
        setTextLimit(nextLimit);
        return;
      }
      const next: number[][] = [[]];
      let height = 0;
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index]!;
        node.style.setProperty("--page-width", `${container.clientWidth}px`);
        const itemHeight = Math.ceil(node.getBoundingClientRect().height) + 8;
        const categoryBoundary =
          index > 0 && itemCategoryIds?.[index] !== itemCategoryIds?.[index - 1];
        if (
          (categoryBoundary || height + itemHeight > available) &&
          next.at(-1)!.length
        ) {
          next.push([]);
          height = 0;
        }
        next.at(-1)!.push(index);
        height += itemHeight;
      }
      const nextLayout = {
        pages: next,
        categoryIds: next.map((indices) => itemCategoryIds?.[indices[0]!]),
        firstItemKeys: next.map((indices) => itemKeys[indices[0]!]),
      };
      setLayout((previous) =>
        JSON.stringify(previous) === JSON.stringify(nextLayout)
          ? previous
          : nextLayout,
      );
      // Keep the same category and visible item when pages are remeasured.
      // A global page number alone would drift into another category on resize.
      const preferredCategory = expandedCategoryId ?? layout.categoryIds[current];
      if (preferredCategory) {
        const matchingPages = next
          .map((indices, index) => ({ indices, index }))
          .filter(
            (entry) => itemCategoryIds?.[entry.indices[0]!] === preferredCategory,
          );
        const matchingItemPage = matchingPages.find((entry) =>
          entry.indices.some(
            (index) => itemKeys[index] === layout.firstItemKeys[current],
          ),
        );
        const nextPage =
          matchingItemPage ??
          matchingPages[
            expandedCategoryId
              ? 0
              : Math.min(categoryPage, matchingPages.length - 1)
          ];
        if (nextPage) setPage(nextPage.index);
      }
      // A full-text selection becomes the current page again after text shrinks.
      if (expandedCategoryId) setExpandedCategoryId(undefined);
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    observer?.observe(container);
    container
      .querySelectorAll<HTMLElement>(":scope > [data-page-item]")
      .forEach((node) => observer?.observe(node));
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  });

  function turn(next: number) {
    setExpandedCategoryId(undefined);
    setPage(next);
    requestAnimationFrame(() =>
      content.current?.focus({ preventScroll: true }),
    );
  }

  function jump(categoryId: string) {
    const firstPage = layout.categoryIds.findIndex((id) => id === categoryId);
    if (firstPage >= 0) setPage(firstPage);
    if (expanded) setExpandedCategoryId(categoryId);
    requestAnimationFrame(() => {
      if (!expanded) {
        content.current?.focus({ preventScroll: true });
        return;
      }
      const anchor = [
        ...(content.current?.querySelectorAll<HTMLElement>(
          ":scope > [data-page-category-start]",
        ) ?? []),
      ].find((node) => node.dataset.pageCategoryStart === categoryId);
      anchor?.focus({ preventScroll: true });
      anchor?.scrollIntoView?.({ block: "start", behavior: "auto" });
    });
  }

  return (
    <section
      className={`page-deck${categoryItems?.length ? " page-deck-categorized" : ""}${expanded ? " page-deck-expanded" : ""}`}
      aria-label={label}
      data-page-deck
    >
      {!!categoryItems?.length && (
        <label className="page-category-navigation">
          <span>カテゴリ</span>
          <select
            aria-label={`${label}のカテゴリ`}
            aria-controls={id}
            aria-describedby={statusId}
            value={currentCategory?.id ?? ""}
            onChange={(event) => jump(event.target.value)}
          >
            {categoryItems.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div
        ref={content}
        id={id}
        className="page-content"
        tabIndex={-1}
        aria-label={`${label}の内容`}
        aria-describedby={statusId}
        data-page-current={current + 1}
        data-page-category={currentCategory?.id}
      >
        {items.map((item, index) => {
          const visible =
            expanded || (pages[current]?.includes(index) ?? index === 0);
          const categoryId = itemCategoryIds?.[index];
          const categoryStart =
            categoryId &&
            (index === 0 || itemCategoryIds?.[index - 1] !== categoryId)
              ? categoryId
              : undefined;
          return (
            <div
              key={isValidElement(item) ? (item.key ?? index) : index}
              data-page-item
              data-page-category={categoryId}
              data-page-category-start={categoryStart}
              role={categoryStart ? "group" : undefined}
              tabIndex={categoryStart ? -1 : undefined}
              aria-label={
                categoryStart
                  ? categoryItems?.find(
                      (category) => category.id === categoryStart,
                    )?.label
                  : undefined
              }
              hidden={!visible}
              inert={!visible}
            >
              {item}
            </div>
          );
        })}
      </div>
      <div
        className="page-controls"
        role="group"
        aria-label={`${label}のページを切り替える`}
      >
        <button
          type="button"
          aria-label={`${label}の前のページ`}
          aria-controls={id}
          disabled={current === 0 || expanded}
          onClick={() => turn(current - 1)}
        >
          前へ
        </button>
        <span id={statusId} role="status" aria-live="polite">
          {status}
        </span>
        <button
          type="button"
          aria-label={`${label}の次のページ`}
          aria-controls={id}
          disabled={current >= pageCount - 1 || expanded}
          onClick={() => turn(current + 1)}
        >
          次へ
        </button>
      </div>
      {actions && <div className="page-actions actions">{actions}</div>}
    </section>
  );
}
