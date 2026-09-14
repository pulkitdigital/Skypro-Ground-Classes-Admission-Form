import React from "react";
import {
  FaPhoneAlt,
  FaEnvelope,
  FaMapMarkerAlt,
  FaGlobe,
  FaInstagram,
  FaYoutube,
} from "react-icons/fa";

const Footer = () => {
  return (
    <footer className="bg-[#0b3b6f] text-white">
      <div className="max-w-7xl mx-auto px-4 py-14">
        {/* Top Grid */}
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-4">
          {/* Contact Us */}
          <div>
            <a
              className="text-yellow-400 text-2xl font-semibold block mb-6"
            >
              Contact Us
            </a>

            <ul className="space-y-4 text-lg">
              <li>
                <a
                  href="tel:+918955804726"
                  className="flex items-center gap-3 hover:text-yellow-400"
                >
                  <FaPhoneAlt />
                  +91-8955804726
                </a>
              </li>

              <li>
                <a
                  href="mailto:info@skyproaviation.org"
                  className="flex items-center gap-3 hover:text-yellow-400"
                >
                  <FaEnvelope />
                  info@skyproaviation.org
                </a>
              </li>

              <li>
                <a
                  href="https://maps.app.goo.gl/jfvUp9aKGDkAUVH56, Ganesham Complex, Devi Nagar, New Sanganer Road, Jaipur, Rajasthan 302019"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-3 hover:text-yellow-400 leading-relaxed"
                >
                  <FaMapMarkerAlt className="mt-1" />
                  69, Ganesham Complex, Devi Nagar, New Sanganer Road, Jaipur,
                  Rajasthan 302019
                </a>
              </li>

              <li>
                <a
                  href="https://www.skyproaviation.org"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 hover:text-yellow-400"
                >
                  <FaGlobe />
                  www.skyproaviation.org
                </a>
              </li>
            </ul>

            {/* Social Icons */}
            <div className="flex gap-4 mt-6">
              <a
                href="https://www.instagram.com/skyproaviation_/"
                target="_blank"
                rel="noreferrer"
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-yellow-400 hover:text-black transition"
              >
                <FaInstagram />
              </a>

              <a
                href="https://www.youtube.com/@skypro-aviation"
                target="_blank"
                rel="noreferrer"
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-yellow-400 hover:text-black transition"
              >
                <FaYoutube />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <a
              href="/"
              className="text-yellow-400 text-2xl font-semibold block mb-6"
            >
              Quick Links
            </a>

            <ul className="space-y-3 text-lg">
              {[
                ["Home", "https://skyproaviation.org/"],
                ["About Us", "https://skyproaviation.org/about-us/"],
                ["Contact Us", "https://skyproaviation.org/contact-us/"],
                ["Business Partners", "https://skyproaviation.org/business-partners/"],
                ["Disclaimer", "https://skyproaviation.org/disclaimer/"],
                ["Privacy Policy", "https://skyproaviation.org/privacy-policy/"],
                ["Terms Of Use", "https://skyproaviation.org/terms-of-use/"],
                ["Cookie Policy", "https://skyproaviation.org/cookie-policy/"],
              ].map(([label, link]) => (
                <li key={label}>
                  <a href={link} className="hover:text-yellow-400">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Courses */}
          <div>
            <a
              href="/courses"
              className="text-yellow-400 text-2xl font-semibold block mb-6"
            >
              Our Courses
            </a>

            <ul className="space-y-3 text-lg">
              {[
                ["DGCA Ground Classes", "https://skyproaviation.org/ground-classes-for-dgca-exams/"],
                ["ATPL Theory Training", "/atpl-theory-training"],
                ["Flight Training", "/flight-training"],
                ["Type Rating", "/type-rating"],
                ["License Conversion", "/license-conversion"],
                ["Mentorship Programme", "/mentorship-programme"],
              ].map(([label, link]) => (
                <li key={label}>
                  <a href={link} className="hover:text-yellow-400">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Map */}
          <div className="w-[full] h-[260px] md:h-[200px] lg:h-[260px]">
            <iframe
              title="SkyPro Aviation Location"
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3558.5612461049195!2d75.76358437414842!3d26.885677561254212!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x396db5eb1a617b85%3A0x9515c4b2610c212f!2sSkyPro%20Aviation!5e0!3m2!1sen!2sin!4v1768627678561!5m2!1sen!2sin"
              className="w-full h-full border-0"
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-white/20 mt-12 pt-6 flex flex-col md:flex-row justify-between gap-4 text-md text-white/80">
          <a
            href="https://bebeyond.digital/"
            target="_blank"
            rel="noreferrer"
            className="hover:text-yellow-400"
          >
            Created By BeBeyond
          </a>

          <a href="/" className="hover:text-yellow-400">
            Copyright © 2026 SkyPro Aviation
          </a>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
