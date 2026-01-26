const LoanUser = require("../models/Loan.model");
const LoanTable = require("../models/Table.model");
const { Sequelize } = require("sequelize");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { Op } = require("sequelize");

// 🔹 Get All Loans
const getAllLoans = async (req, res, next) => {
  const { section } = req.query;
  try {
    const loans = await LoanUser.findAll({
      where: { section: section },
      order: [['sno', 'ASC']]
    });
    res.status(200).json({
      success: true,
      data: loans,
    });
  } catch (error) {
    next(error);
  }
};

// 🔹 Create New Loan
const createLoan = async (req, res, next) => {
  try {
    const loanData = req.body;
    // Check for existing loan with same sNo and section
    const existingLoan = await LoanUser.findOne({
      where: {
        sno: loanData.sno,
        section: loanData.section,
      },
    });
    if (existingLoan) {
      return res.status(400).json({
        success: false,
        message: `Loan with sNo ${loanData.sno} and section ${loanData.section} already exists.`,
      });
    }

    const newLoan = await LoanUser.create(loanData);
    res.status(201).json({
      success: true,
      message: "Loan created successfully",
      data: newLoan,
    });
  } catch (error) {
    next(error);
  }
};

const getTablesByLoanId = async (req, res, next) => {
  try {
    const { loanId } = req.query;
    const details = await LoanUser.findOne({
      where: { loanId },
    });
    const entries = await LoanTable.findAll({
      where: { loanId },
      order: [['date', 'ASC']]
    });
    res.status(200).json({
      success: true,
      data: entries,
      user: details,
    });
  } catch (error) {
    next(error);
  }
};

const deleteLoanById = async (req, res, next) => {
  try {
    const { id } = req.query;

    const deletedRows = await LoanUser.destroy({
      where: { loanId: id },
    });
    await LoanTable.destroy({
      where: { loanId: id },
    });
    if (deletedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Loan not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Loan deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// 🔹 Update Loan by ID
const updateLoanById = async (req, res, next) => {
  try {
    const { loanId, sno, section, ...updateFields } = req.body;

    if (!loanId || sno === undefined || !section) {
      return res.status(400).json({
        success: false,
        message: "loanId, sno, and section are required",
      });
    }

    // 🔹 1️⃣ Find loan by UNIQUE loanId
    const exactMatch = await LoanUser.findOne({
      where: { loanId },
    });

    if (!exactMatch) {
      return res.status(404).json({
        success: false,
        message: "Loan record not found",
      });
    }

    // 🔹 2️⃣ Optional sno conflict check (safe)
    const snoConflict = await LoanUser.findOne({
      where: {
        sno,
        section,
      },
    });

    if (snoConflict && snoConflict.loanId !== exactMatch.loanId) {
      return res.status(400).json({
        success: false,
        message: "S.No already allocated for another section",
      });
    }

    // 🔹 Helper
    const safeNum = (val, fallback) => {
      if (val === undefined || val === null || val === "") return fallback;
      const num = Number(val);
      return isNaN(num) ? fallback : num;
    };

    const finalSection = section || exactMatch.section;

    const givenAmount = safeNum(
      updateFields.givenAmount,
      exactMatch.givenAmount
    );

    const interestPercent = safeNum(
      updateFields.interestPercent,
      exactMatch.interestPercent || 0
    );

    let interest = safeNum(
      updateFields.interest,
      exactMatch.interest || 0
    );

    // 🔥 Interest calculation
    if (finalSection === "Interest") {
      interest = Math.round((givenAmount * interestPercent) / 100);
    }

    const tamount = givenAmount + interest;

    // 🔹 3️⃣ UPDATE USING INSTANCE (CORRECT WAY)
    await exactMatch.update({
      ...updateFields,
      sno,
      section: finalSection,
      givenAmount,
      interest,
      interestPercent,
      tamount,
    });

    // 🔹 4️⃣ Return updated record
    res.status(200).json({
      success: true,
      message: "Loan updated successfully",
      data: exactMatch,
    });

  } catch (error) {
    next(error);
  }
};

// 🔹 Table CRUD Operations
const saveTable = async (req, res, next) => {
  try {
    const { loanId, date, amount } = req.body;

    if (!loanId || !date || !amount) {
      return res.status(400).json({
        success: false,
        message: "loanId, date, and amount are required",
      });
    }

    // 1️⃣ Check loan exists
    const loan = await LoanUser.findOne({ where: { loanId } });
    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Loan not found",
      });
    }

    // 2️⃣ Check SAME loanId + date already exists
    const existingEntry = await LoanTable.findOne({
      where: {
        loanId,
        date,
      },
    });

    if (existingEntry) {
      return res.status(409).json({
        success: false,
        message: "Entry for this date already exists for this loan",
      });
    }

    // 3️⃣ Create new table entry
    const newEntry = await LoanTable.create({
      loanId,
      date,
      amount: Number(amount),
    });

    // 4️⃣ Update paid amount
    const newPaid = (Number(loan.paid) || 0) + Number(amount);

    await loan.update({ paid: newPaid });

    res.status(201).json({
      success: true,
      message: "Entry created successfully",
      data: newEntry,
      updatedPaid: newPaid,
    });
  } catch (error) {
    next(error);
  }
};

// 🔹 Update Table Entry
const updateTableEntry = async (req, res, next) => {
  try {
    const { loanId, date, amount, newDate } = req.body;

    if (!loanId || !date) {
      return res.status(400).json({
        success: false,
        message: "loanId and date are required",
      });
    }

    // 1️⃣ Find table entry by loanId + date
    const tableEntry = await LoanTable.findOne({
      where: { loanId, date },
    });

    if (!tableEntry) {
      return res.status(404).json({
        success: false,
        message: "Table entry not found",
      });
    }

    const oldAmount = Number(tableEntry.amount) || 0;
    const newAmount = amount !== undefined ? Number(amount) : oldAmount;

    // 2️⃣ Calculate difference
    const difference = newAmount - oldAmount;

    // 3️⃣ Update table entry
    tableEntry.amount = newAmount;
    if (newDate) tableEntry.date = newDate;
    await tableEntry.save();

    // 4️⃣ Update LoanUser paid
    if (difference !== 0) {
      const loan = await LoanUser.findOne({ where: { loanId } });
      if (loan) {
        const updatedPaid = (Number(loan.paid) || 0) + difference;
        await loan.update({ paid: updatedPaid });
      }
    }

    res.status(200).json({
      success: true,
      message: "Table entry updated successfully",
      data: tableEntry,
    });
  } catch (error) {
    next(error);
  }
};

const getLoanSummary = async (req, res, next) => {
  try {
    // 🔹 Section-wise summary
    const sectionSummary = await LoanUser.findAll({
      attributes: [
        "section",
        [Sequelize.fn("SUM", Sequelize.col("tamount")), "totalAmount"],
        [Sequelize.fn("SUM", Sequelize.col("paid")), "paidAmount"],
        [Sequelize.literal("SUM(tamount - paid)"), "balanceAmount"],
      ],
      where: {
        section: ["Daily", "Weekly", "Monthly"],
      },
      group: ["section"],
      order: [['section', 'ASC']]
    });

    // 🔹 Overall total summary
    const totalSummary = await LoanUser.findOne({
      attributes: [
        [Sequelize.fn("SUM", Sequelize.col("tamount")), "totalAmount"],
        [Sequelize.fn("SUM", Sequelize.col("paid")), "paidAmount"],
        [Sequelize.literal("SUM(tamount - paid)"), "balanceAmount"],
      ],
    });

    return res.status(200).json({
      success: true,
      sections: sectionSummary,
      total: totalSummary,
    });
  } catch (error) {
    next(error);
  }
};

const formatDateDMY = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    // If it's already dd-mm-yyyy string, returning it is tricky if we don't know the format.
    // But since the user wants dd-mm-yyyy, we'll try to ensure it.
    if (typeof dateStr === "string" && /^\d{2}-\d{2}-\d{4}$/.test(dateStr)) return dateStr;
    return dateStr;
  }
  return `${String(d.getDate()).padStart(2, "0")}-${String(
    d.getMonth() + 1
  ).padStart(2, "0")}-${d.getFullYear()}`;
};

/* ======================================================
   CONTROLLER
====================================================== */

const toISO = (dateStr) => {
  const [dd, mm, yyyy] = dateStr.split("-");
  return `${yyyy}-${mm}-${dd}`;
};

const downloadReport = async (req, res, next) => {
  try {
    const { dataType, section, areas, day, fromDate, toDate } = req.body;
    if (!dataType || !fromDate || !toDate) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const headerText = `Report: ${dataType} | Section: ${section || "All"
      } | Area: ${areas?.join(", ") || "All"} | Day: ${day || "All"
      } | From: ${fromDate} | To: ${toDate}`;

    /* ======================================================
       1️⃣ CUSTOMER DATA → EXCEL
    ====================================================== */
    if (dataType === "Customer Data") {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Customers");

      const columns = [
        { header: "S.No", key: "sno", width: 8 },
        { header: "Loan ID", key: "loanId", width: 30 },
        { header: "Section", key: "section", width: 12 },
        { header: "Area", key: "area", width: 12 },
        { header: "Day", key: "day", width: 15 },
        { header: "Name", key: "name", width: 20 },
        { header: "Address", key: "address", width: 25 },
        { header: "Phone", key: "phoneNumber", width: 15 },
        { header: "Alt Phone", key: "alternativeNumber", width: 15 },
        { header: "Work", key: "work", width: 15 },
        { header: "H/O / W/O", key: "houseWifeOrSonOf", width: 18 },
        { header: "Given Amount", key: "givenAmount", width: 15 },
        { header: "Paid", key: "paid", width: 12 },
        { header: "Pending", key: "pending", width: 12 },
        { header: "Interest", key: "interest", width: 12 },
        { header: "Total", key: "tamount", width: 15 },
        { header: "Given Date", key: "givenDate", width: 15 },
        { header: "Last Date", key: "lastDate", width: 15 },
        { header: "Additonal Info", key: "additionalInfo", width: 15 },
        { header: "VerifiedBy", key: "verifiedBy", width: 15 },
        { header: "VerifiedNo", key: "verifiedNo", width: 15 },
      ];

      sheet.columns = columns;
      sheet.insertRow(1, [headerText]);
      sheet.mergeCells(1, 1, 1, columns.length);
      sheet.getRow(1).font = { bold: true };

      // sheet.addRow([]);
      // sheet.addRow(columns.map((c) => c.header));
      // sheet.getRow(3).font = { bold: true };

      const where = {};
      if (section) where.section = section;
      if (areas?.length) where.area = { [Op.in]: areas };
      if (section === "Weekly" && day) where.day = day;
      if (fromDate && toDate) {
        const fromISO = toISO(fromDate);
        const toISODate = toISO(toDate);

        if (fromISO === toISODate) {
          where.givenDate = {
            [Op.eq]: fromISO,
          };
        } else {
          where.givenDate = {
            [Op.between]: [fromISO, toISODate],
          };
        }
      }

      const users = await LoanUser.findAll({
        where,
        order: [["sno", "ASC"]],
      });

      let totalGiven = 0, totalPaid = 0, totalPending = 0, totalInterest = 0, totalFinal = 0;

      users.forEach((u) => {
        const principal = Number(u.givenAmount || 0);
        const paid = Number(u.paid || 0);
        const interest = Number(u.interest || 0);
        const total = Number(u.tamount || 0);
        const pending = total - paid;

        totalGiven += principal;
        totalPaid += paid;
        totalPending += pending;
        totalInterest += interest;
        totalFinal += total;

        sheet.addRow({
          ...u.toJSON(),
          pending,
          givenDate: formatDateDMY(u.givenDate),
          lastDate: formatDateDMY(u.lastDate),
         additionalInfo: u.additionalInfo,
          verifiedBy: u.verifiedBy,
          verifiedNo: u.verifiedByNo
        });
      });

      // Add Total Row
      const totalRow = sheet.addRow({
        houseWifeOrSonOf: "TOTAL",
        givenAmount: totalGiven,
        paid: totalPaid,
        pending: totalPending,
        interest: totalInterest,
        tamount: totalFinal
      });
      totalRow.font = { bold: true };

      res.setHeader(
        "Content-Disposition",
        `attachment; filename=customers_${Date.now()}.xlsx`
      );
      await workbook.xlsx.write(res);
      return res.end();
    }

    /* ======================================================
       2️⃣ COLLECTION → EXCEL
    ====================================================== */
    if (dataType === "Collection") {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Collections");

      columns = [
        { header: "S.No", key: "sno", width: 8 },
        { header: "Name", key: "name", width: 20 },
        { header: "Date", key: "date", width: 15 },
        { header: "Amount", key: "amount", width: 15 },
      ];
      sheet.columns = columns;
      sheet.insertRow(1, [headerText]);
      sheet.mergeCells(1, 1, 1, 8);
      sheet.getRow(1).font = { bold: true };

      const fromISO = toISO(fromDate);
      const toISODate = toISO(toDate);

      let dateCondition = {};

      if (fromISO === toISODate) {
        // ✅ SAME DAY → exact match
        dateCondition = { [Op.eq]: fromISO };
      } else {
        // ✅ RANGE
        dateCondition = { [Op.between]: [fromISO, toISODate] };
      }

      const collections = await LoanTable.findAll({
        where: {
          date: dateCondition,
        },
        order: [["date", "ASC"]],
      });


      const loanIds = [...new Set(collections.map((c) => c.loanId))];

      const where = {};
      if (loanIds?.length) {
        where.loanId = { [Op.in]: loanIds };
      }

      if (section) where.section = section;
      if (areas?.length) {
        where.area = { [Op.in]: areas };
      }
      if (section === "Weekly" && day) {
        where.day = day;
      }


      // ✅ final query
      const users = await LoanUser.findAll({
        where,
        order: [["sno", "ASC"]],
      });
      const userMap = {};
      users.forEach((u) => (userMap[u.loanId] = u));

      let totalCollection = 0;
      collections.forEach((c) => {
        const user = userMap[c.loanId];
        if (!user) return;
        const amt = Number(c.amount || 0);
        totalCollection += amt;
        sheet.addRow({
          sno: userMap[c.loanId]?.sno,
          name: userMap[c.loanId]?.name,
          date: formatDateDMY(c.date),
          amount: amt,
        });
      });

      // Add Total Row
      const totalRow = sheet.addRow({
        date: "TOTAL",
        amount: totalCollection
      });
      totalRow.font = { bold: true };

      res.setHeader(
        "Content-Disposition",
        `attachment; filename=collections_${Date.now()}.xlsx`
      );
      await workbook.xlsx.write(res);
      return res.end();
    }

    /* ======================================================
       3️⃣ FULL DATA → PDF
    ====================================================== */
    if (dataType === "Full Data") {
      const PDFDocument = require("pdfkit");
      const doc = new PDFDocument({ margin: 40, size: "A4" });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=full_report_${Date.now()}.pdf`
      );

      doc.pipe(res);

      /* -------------------- CONSTANTS -------------------- */
      const PAGE_BOTTOM = 750;
      const START_Y = 50;
      const ROW_HEIGHT = 14;
      const LEFT_X = 45;
      const RIGHT_X = 300;

      /* -------------------- HELPERS -------------------- */
      const checkPageBreak = (y, redrawTableHeader) => {
        if (y > PAGE_BOTTOM) {
          doc.addPage();
          return redrawTableHeader ? redrawTableHeader(START_Y) : START_Y;
        }
        return y;
      };

      const drawCollectionsHeader = (y) => {
        doc.rect(45, y, 515, 16).fill("#eeeeee");
        doc.fillColor("#000").font("Helvetica-Bold").fontSize(9);
        doc.text("S.No", 50, y + 4);
        doc.text("Date", 200, y + 4);
        doc.text("Amount", 400, y + 4);
        return y + 16;
      };

      /* -------------------- DOCUMENT HEADER -------------------- */
      doc.font("Helvetica-Bold")
        .fontSize(16)
        .text("Full Customer Loan Report", { align: "center" });

      doc.font("Helvetica")
        .fontSize(10)
        .text(headerText, { align: "center" });

      doc.moveDown(2);

      /* -------------------- FETCH USERS -------------------- */
      const where = {};
      if (section) where.section = section;
      if (areas?.length) where.area = { [Op.in]: areas };
      if (section === "Weekly" && day) where.day = day;

      if (fromDate && toDate) {
        const fromISO = toISO(fromDate);
        const toISODate = toISO(toDate);
        where.givenDate =
          fromISO === toISODate
            ? { [Op.eq]: fromISO }
            : { [Op.between]: [fromISO, toISODate] };
      }

      const users = await LoanUser.findAll({
        where,
        order: [["sno", "ASC"]],
      });

      /* -------------------- LOOP USERS -------------------- */
      for (const u of users) {

        /* ---------- CUSTOMER HEADER ---------- */
        doc.rect(LEFT_X, doc.y, 515, 22).fill("#f2f2f2");
        doc.fillColor("#000")
          .font("Helvetica-Bold")
          .fontSize(11)
          .text(`Customer: ${u.name} (S.No: ${u.sno})`, LEFT_X + 5, doc.y + 6);

        doc.y += 30;

        /* ---------- CUSTOMER DETAILS ---------- */
        let y = doc.y;
        doc.font("Helvetica").fontSize(9);

        const leftData = [
          `Loan ID: ${u.loanId}`,
          `Area: ${u.area}`,
          `Address: ${u.address}`,
          `Alt Phone: ${u.alternativeNumber || "N/A"}`,
          `H/O / W/O: ${u.houseWifeOrSonOf || "N/A"}`,
          `Refer No: ${u.referNumber || "N/A"}`,
          `Paid: RS. ${u.paid}`,
          `Interest %: ${u.interestPercent || 0}%`,
          `Total Amount: RS. ${u.tamount}`,
          `Last Date: ${formatDateDMY(u.lastDate)}`,
        ];

        const rightData = [
          `Section: ${u.section}`,
          `Day: ${u.day || "N/A"}`,
          `Phone: ${u.phoneNumber}`,
          `Work: ${u.work || "N/A"}`,
          `Refer Name: ${u.referName || "N/A"}`,
          `Given Amount: RS. ${u.givenAmount}`,
          `Pending: RS. ${(Number(u.tamount) || 0) - (Number(u.paid) || 0)}`,
          `Interest: RS. ${u.interest || 0}`,
          `Given Date: ${formatDateDMY(u.givenDate)}`,
          `Verified No: ${u.verifiedByNo || "N/A"}`,
        ];

        for (let i = 0; i < leftData.length; i++) {
          y = checkPageBreak(y);
          doc.text(leftData[i], LEFT_X, y);
          doc.text(rightData[i], RIGHT_X, y);
          y += ROW_HEIGHT;
        }

        /* ---------- ADDITIONAL INFO ---------- */
        y += ROW_HEIGHT;
        y = checkPageBreak(y);

        doc.font("Helvetica-Bold").text("Additional Info:", LEFT_X, y);
        doc.font("Helvetica").text(
          u.additionalInfo || "N/A",
          LEFT_X + 90,
          y,
          { width: 420 }
        );

        y += ROW_HEIGHT * 3;
        doc.y = y;

        /* ---------- COLLECTIONS HISTORY ---------- */
        doc.y += 20;

        // ✅ TITLE PRINTED ONLY ONCE
        doc.font("Helvetica-Bold")
          .fontSize(10)
          .text("Collections History", LEFT_X, doc.y);

        doc.y += 15;

        // ✅ FIRST TABLE HEADER
        let tableY = drawCollectionsHeader(doc.y);

        const collections = await LoanTable.findAll({
          where: { loanId: u.loanId },
          order: [["date", "ASC"]],
        });

        doc.font("Helvetica").fontSize(9);
        let totalCollected = 0;

        collections.forEach((c, index) => {
          tableY = checkPageBreak(tableY, (newY) => {
            return drawCollectionsHeader(newY); // ✅ only table header
          });

          doc.text(index + 1, 50, tableY);
          doc.text(formatDateDMY(c.date), 200, tableY);
          doc.text(`RS. ${c.amount}`, 400, tableY);

          totalCollected += Number(c.amount || 0);
          tableY += ROW_HEIGHT;
        });

        /* ---------- TOTAL ROW ---------- */
        tableY = checkPageBreak(tableY + 10);
        doc.font("Helvetica-Bold")
          .text(`Total Collected: RS. ${totalCollected}`, 350, tableY);

        /* ---------- SEPARATOR ---------- */
        doc.y = tableY + 25;
        doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke("#cccccc");
        doc.y += 20;

        /* ---------- PAGE SAFETY ---------- */
        if (doc.y > 650) {
          doc.addPage();
          doc.y = START_Y;
        }
      }

      doc.end();
      return;
    }

    res.status(400).json({ message: "Invalid dataType" });
  } catch (error) {
    next(error);
  }
};


const renewLoan = async (req, res, next) => {
  try {
    const { loanId, givenAmount, section, interestPercent, interest, givenDate, lastDate, ...otherData } = req.body;

    if (!loanId) {
      return res.status(400).json({
        success: false,
        message: "loanId is required",
      });
    }

    // 1️⃣ Find the loan
    const loan = await LoanUser.findOne({ where: { loanId } });
    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Loan not found",
      });
    }

    // 2️⃣ Prepare updated values
    const finalGivenAmount = givenAmount !== undefined ? Number(givenAmount) : Number(loan.givenAmount);
    const finalSection = section || loan.section;

    let finalInterest = 0;
    let finalInterestPercent = interestPercent !== undefined ? Number(interestPercent) : Number(loan.interestPercent);

    if (finalSection === "Interest") {
      // If interest section, calculate from percent
      finalInterest = Math.round((finalGivenAmount * finalInterestPercent) / 100);
    } else {
      // Otherwise use interest amount from body or existing
      finalInterest = interest !== undefined ? Number(interest) : Number(loan.interest);
    }

    const finalTamount = finalGivenAmount + finalInterest;

    // 3️⃣ Update LoanUser record (RESTRICTED FIELDS)
    const updateFields = {
      givenAmount: finalGivenAmount,
      section: finalSection,
      interestPercent: finalInterestPercent,
      interest: finalInterest,
      tamount: finalTamount,
      givenDate: givenDate || loan.givenDate,
      lastDate: lastDate || loan.lastDate,
      paid: 0, // Always reset paid to 0
    };

    // Optional: Allow updating phone/address during renewal if provided
    if (otherData.name) updateFields.name = otherData.name;
    if (otherData.address) updateFields.address = otherData.address;
    if (otherData.phoneNumber) updateFields.phoneNumber = otherData.phoneNumber;

    await loan.update(updateFields);

    // 4️⃣ Delete all entries in LoanTable for this loan
    await LoanTable.destroy({
      where: { loanId },
    });

    // 5️⃣ Refresh loan data to return all model fields
    await loan.reload();

    res.status(200).json({
      success: true,
      message: "Loan renewed successfully.",
      data: loan,
    });
  } catch (error) {
    next(error);
  }
};


module.exports = {
  getAllLoans,
  createLoan,
  updateLoanById,
  deleteLoanById,
  saveTable,
  getTablesByLoanId,
  updateTableEntry,
  getLoanSummary,
  downloadReport,
  renewLoan,
};
