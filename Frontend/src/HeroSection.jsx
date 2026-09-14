import { useState } from "react";

export default function NavbarHero() {
  const [mobileMenu, setMobileMenu] = useState(false);
  const [coursesOpen, setCoursesOpen] = useState(false);

  const isActive = (path) => window.location.pathname === path;

  return (
    <div className="relative w-full overflow-x-hidden">
      {/* ================= NAVBAR ================= */}
      <nav className="fixed top-4 left-0 right-0 z-50">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex items-center justify-between rounded-full bg-white px-6 py-3 shadow-lg">
            {/* Logo */}
            <a href="/" className="flex items-center gap-2">
              <img
                src="/logo.webp"
                alt="SkyPro Aviation"
                className="h-10 w-auto"
              />
            </a>

            {/* ================= DESKTOP MENU ================= */}
            <ul className="hidden items-right gap-8 text-sm font-bold text-gray-800 md:flex">
              <li className="flex items-center">
                <a href="https://skyproaviation.org/" className={isActive('/') ? 'text-[#003366]' : 'hover:text-[#003366]'} target="_blank">
                  Home
                </a>
              </li>

              {/* COURSES DROPDOWN */}
              <li
                className="relative flex items-center"
                onMouseEnter={() => setCoursesOpen(true)}
                onMouseLeave={() => setCoursesOpen(false)}
              >
                <button className="flex items-center gap-1 hover:text-[#003366]">
                  Courses
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {coursesOpen && (
                  <div className="absolute left-0 top-10 w-56 rounded-xl bg-white shadow-xl border">
                    <ul className="py-2 text-sm text-gray-700">
                      <li>
                        <a href="https://skyproaviation.org/ground-classes-for-dgca-exams/" className="block px-4 py-2 hover:bg-gray-100" target="_blank">
                          DGCA Ground Classes
                        </a>
                      </li>
                    </ul>
                  </div>
                )}
              </li>

              <li className="flex items-center">
                <a href="https://skyproaviation.org/about-us/" className={isActive('/about-us') ? 'text-[#003366]' : 'hover:text-[#003366]'} target="_blank">
                  About Us
                </a>
              </li>
              <li className="flex items-center">
                <a href="https://skyproaviation.org/business-partners/" className={isActive('/partners') ? 'text-[#003366]' : 'hover:text-[#003366]'} target="_blank">
                  Partners
                </a>
              </li>
              <li className="flex items-center">
                <a href="https://skyproaviation.org/contact-us/" className={isActive('/contact-us') ? 'text-[#003366]' : 'hover:text-[#003366]'} target="_blank">
                  Contact Us
                </a>
              </li>
              <li className="flex items-center">
                <a href="https://classes.skyproaviation.org/" className={isActive('/student-dashboard') ? 'text-[#003366]' : 'hover:text-[#003366]'} target="_blank">
                  Student Dashboard
                </a>
              </li>
              <li className="flex items-center">
                <a
                  href="https://skyproaviation.org/enquire/"
                  className="hidden rounded-full bg-[#003366] px-6 py-3 text-sm font-semibold text-white hover:bg-[#f4b224] md:block"
                  target="_blank"
                >
                  Enquire
                </a>
              </li>
            </ul>

            {/* CTA */}

            {/* MOBILE TOGGLE */}
            <button
              onClick={() => setMobileMenu(!mobileMenu)}
              className="md:hidden text-gray-800"
            >
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={mobileMenu ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"}
                />
              </svg>
            </button>
          </div>

          {/* ================= MOBILE MENU ================= */}
          {mobileMenu && (
            <div className="mt-3 rounded-2xl bg-white p-6 shadow-lg md:hidden">
              <ul className="flex flex-col gap-4 text-sm font-semibold text-gray-800">
                <li>
                  <a href="https://skyproaviation.org/" className={isActive('/') ? 'text-[#003366]' : ''}>
                    Home
                  </a>
                </li>

                {/* MOBILE COURSES */}
                <li>
                  <button
                    onClick={() => setCoursesOpen(!coursesOpen)}
                    className="flex w-full items-center justify-between"
                  >
                    Courses
                    <svg
                      className={`h-4 w-4 transition ${
                        coursesOpen ? "rotate-180" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>

                  {coursesOpen && (
                    <div className="mt-2 ml-3 flex flex-col gap-2 text-sm text-gray-700">
                      <a href="https://skyproaviation.org/ground-classes-for-dgca-exams/" target="_blank">DGCA Ground Classes</a>
                    </div>
                  )}
                </li>

                <li>
                  <a href="https://skyproaviation.org/about-us/" className={isActive('/about-us') ? 'text-[#003366]' : ''} target="_blank">
                    About Us
                  </a>
                </li>
                <li>
                  <a href="https://skyproaviation.org/business-partners/" className={isActive('/partners') ? 'text-[#003366]' : ''} target="_blank">
                    Partners
                  </a>
                </li>
                <li>
                  <a href="https://skyproaviation.org/contact-us/" className={isActive('/contact-us') ? 'text-[#003366]' : ''} target="_blank">
                    Contact Us
                  </a>
                </li>
                <li>
                  <a href="https://classes.skyproaviation.org/" className={isActive('/student-dashboard') ? 'text-[#003366]' : ''} target="_blank">
                    Student Dashboard
                  </a>
                </li>

                <a
                  href="https://skyproaviation.org/enquire/"
                  className="mt-2 rounded-full bg-[#003366] py-2 text-center text-white"
                  target="_blank"
                >
                  Enquire
                </a>
              </ul>
            </div>
          )}
        </div>
      </nav>

      {/* ================= HERO ================= */}
      <section className="relative h-[450px] lg:h-[450px] md:h-[350px] sm:h-[300px] w-full">
        <div
          className="absolute inset-0 bg-cover"
          style={{ backgroundImage: "url('/banner.webp')" }}
        />
        <div className="absolute inset-0 bg-blue-900/60" />

        <div className="relative z-10 flex h-full items-center justify-center px-4">
          <div className="text-center text-white">
            <h1 className="text-3xl font-bold md:text-6xl">Ground School Admission Form</h1>
            <div className="mt-4 text-sm md:text-base">
              <span className=""><a href="" target="_blank">Home</a></span>
              <span className="mx-2">|</span>
              <span className="font-semibold text-yellow-400">Ground School Admission Form</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
