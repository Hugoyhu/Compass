/** Course pages, plus the modal slot that shows a course over the list. */
export default function CoursesLayout({ children, modal }: LayoutProps<"/courses">) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
