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
if (dataType === "Full Data") {
  const doc = new PDFDocument({ margin: 40, size: "A4" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=full_report_${Date.now()}.pdf`
  );

  doc.pipe(res);

  const PAGE_BOTTOM = 750;
  const GAP = 6;

  /* ================= HELPERS ================= */

  const ensureSpace = (height = 60) => {
    if (doc.y + height > PAGE_BOTTOM) {
      doc.addPage();
    }
  };

  const safeValue = (val) => {
    if (val === null || val === undefined || val === "") return "N/A";
    return String(val);
  };

  /**
   * Draw label + value safely (NO overlap, NO empty collapse)
   */
  const drawKeyValue = (label, value, x, width) => {
    const startY = doc.y;

    doc.font("Helvetica-Bold").text(label, x, startY);

    doc.font("Helvetica").text(safeValue(value), {
      width,
      indent: 90, // keeps value away from label
    });

    const usedHeight = doc.y - startY;
    doc.y = startY + usedHeight + GAP;

    return usedHeight + GAP;
  };

  const drawDivider = () => {
    ensureSpace(20);
    doc.moveDown(0.8);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(1);
  };

  /* ================= HEADER ================= */

  doc.fontSize(16)
    .font("Helvetica-Bold")
    .text("Full Customer Loan Report", { align: "center" });

  doc.moveDown(0.5);
  doc.fontSize(10).font("Helvetica").text(headerText, { align: "center" });
  doc.moveDown(2);

  /* ================= FETCH USERS ================= */

  const users = await LoanUser.findAll({
    where: { ...(section && { section }) },
    order: [["sno", "ASC"]],
  });

  /* ================= USERS LOOP ================= */

  for (const u of users) {
    ensureSpace(260);

    /* -------- CUSTOMER HEADER -------- */

    const headerY = doc.y;
    doc.rect(40, headerY, 515, 22).fill("#f2f2f2");
    doc.fillColor("#000");

    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(`Customer: ${safeValue(u.name)} (S.No: ${safeValue(u.sno)})`, 45, headerY + 6);

    doc.y = headerY + 30;
    doc.fontSize(9);

    const leftX = 45;
    const rightX = 300;
    const colWidth = 230;

    const startY = doc.y;
    let leftHeight = 0;
    let rightHeight = 0;

    /* -------- LEFT COLUMN -------- */

    leftHeight += drawKeyValue("Loan ID:", u.loanId, leftX, colWidth);
    leftHeight += drawKeyValue("Area:", u.area, leftX, colWidth);
    leftHeight += drawKeyValue("Address:", u.address, leftX, colWidth);
    leftHeight += drawKeyValue("Alt Phone:", u.alternativeNumber, leftX, colWidth);
    leftHeight += drawKeyValue("H/O / W/O:", u.houseWifeOrSonOf, leftX, colWidth);
    leftHeight += drawKeyValue("Refer Number:", u.referNumber, leftX, colWidth);
    leftHeight += drawKeyValue("Paid:", u.paid ? `Rs. ${u.paid}` : null, leftX, colWidth);
    leftHeight += drawKeyValue(
      "Interest %:",
      u.interestPercent !== null ? `${u.interestPercent}%` : null,
      leftX,
      colWidth
    );
    leftHeight += drawKeyValue(
      "Total Amount:",
      u.tamount ? `Rs. ${u.tamount}` : null,
      leftX,
      colWidth
    );
    leftHeight += drawKeyValue("Last Date:", formatDateDMY(u.lastDate), leftX, colWidth);
    leftHeight += drawKeyValue("Verified By:", u.verifiedBy, leftX, colWidth);

    /* -------- RIGHT COLUMN -------- */

    doc.y = startY;

    rightHeight += drawKeyValue("Section:", u.section, rightX, colWidth);
    rightHeight += drawKeyValue("Day:", u.day, rightX, colWidth);
    rightHeight += drawKeyValue("Phone:", u.phoneNumber, rightX, colWidth);
    rightHeight += drawKeyValue("Work:", u.work, rightX, colWidth);
    rightHeight += drawKeyValue("Refer Name:", u.referName, rightX, colWidth);
    rightHeight += drawKeyValue(
      "Given Amount:",
      u.givenAmount ? `Rs. ${u.givenAmount}` : null,
      rightX,
      colWidth
    );
    rightHeight += drawKeyValue(
      "Pending:",
      u.tamount && u.paid ? `Rs. ${u.tamount - u.paid}` : null,
      rightX,
      colWidth
    );
    rightHeight += drawKeyValue(
      "Interest:",
      u.interest ? `Rs. ${u.interest}` : null,
      rightX,
      colWidth
    );
    rightHeight += drawKeyValue("Given Date:", formatDateDMY(u.givenDate), rightX, colWidth);
    rightHeight += drawKeyValue("Additional Info:", u.additionalInfo, rightX, colWidth);
    rightHeight += drawKeyValue("Verified No:", u.verifiedByNo, rightX, colWidth);

    /* ---- Sync both columns ---- */
    doc.y = startY + Math.max(leftHeight, rightHeight) + 10;

    /* ================= COLLECTIONS ================= */

    ensureSpace(100);
    doc.font("Helvetica-Bold").text("Collections History", 45);
    doc.moveDown(0.5);

    const drawTableHeader = () => {
      ensureSpace(30);
      const y = doc.y;

      doc.rect(45, y, 515, 18).fill("#eeeeee");
      doc.fillColor("#000");

      doc.font("Helvetica-Bold").fontSize(9);
      doc.text("S.No", 50, y + 5);
      doc.text("Date", 150, y + 5);
      doc.text("Amount", 350, y + 5);

      doc.y = y + 22;
    };

    drawTableHeader();

    const collections = await LoanTable.findAll({
      where: { loanId: u.loanId },
      order: [["date", "ASC"]],
    });

    let totalCollected = 0;

    collections.forEach((c, i) => {
      ensureSpace(22);

      if (doc.y + 22 > PAGE_BOTTOM) {
        doc.addPage();
        drawTableHeader();
      }

      totalCollected += Number(c.amount || 0);

      const rowY = doc.y;
      doc.font("Helvetica").fontSize(9);
      doc.text(i + 1, 50, rowY);
      doc.text(formatDateDMY(c.date), 150, rowY);
      doc.text(`Rs. ${Number(c.amount).toFixed(2)}`, 350, rowY);

      doc.y = rowY + 18;
    });

    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").text(
      `Total Collected: Rs. ${totalCollected}`,
      350
    );

    drawDivider();
  }

  doc.end();
  return;
}


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

    // 3️⃣ Update LoanUser record
    await loan.update({
      ...otherData,
      givenAmount: finalGivenAmount,
      section: finalSection,
      interestPercent: finalInterestPercent,
      interest: finalInterest,
      tamount: finalTamount,
      givenDate: givenDate || loan.givenDate,
      lastDate: lastDate || loan.lastDate,
      paid: 0, // Always reset paid to 0
    });

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
