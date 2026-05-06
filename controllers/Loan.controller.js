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

// 🔹 Create New Loan (supports single object or array)
const createLoan = async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    const created = [];
    const errors = [];

    for (const loanData of items) {
      // Check for existing loan with same sNo and section
      const existingLoan = await LoanUser.findOne({
        where: {
          sno: loanData.sno,
          section: loanData.section,
        },
      });
      if (existingLoan) {
        errors.push({
          sno: loanData.sno,
          section: loanData.section,
          message: `Loan with sNo ${loanData.sno} and section ${loanData.section} already exists.`,
        });
        continue;
      }

      const newLoan = await LoanUser.create(loanData);
      created.push(newLoan);
    }

    res.status(201).json({
      success: true,
      message: `${created.length} loan(s) created successfully`,
      data: created.length === 1 ? created[0] : created,
      ...(errors.length > 0 && { errors }),
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

// 🔹 Table CRUD Operations (supports single object or array)
const saveTable = async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    const created = [];
    const errors = [];

    for (const item of items) {
      const { loanId, date, amount } = item;

      if (!loanId || !date || !amount) {
        errors.push({ loanId, date, message: "loanId, date, and amount are required" });
        continue;
      }

      // 1️⃣ Check loan exists
      const loan = await LoanUser.findOne({ where: { loanId } });
      if (!loan) {
        errors.push({ loanId, message: "Loan not found" });
        continue;
      }

      // 2️⃣ Check SAME loanId + date already exists
      const existingEntry = await LoanTable.findOne({
        where: { loanId, date },
      });

      if (existingEntry) {
        errors.push({ loanId, date, message: "Entry for this date already exists for this loan" });
        continue;
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

      created.push({ entry: newEntry, updatedPaid: newPaid });
    }

    res.status(201).json({
      success: true,
      message: `${created.length} entry(ies) created successfully`,
      data: created.length === 1 ? created[0] : created,
      ...(errors.length > 0 && { errors }),
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




const downloadReport = async (req, res) => {
  try {
    const { dataType, section, areas, day, fromDate, toDate } = req.body;

    if (dataType === "Collection") {

      /* ================= DATE FORMAT ================= */
      const formatDate = (date) => {
        const [dd, mm, yyyy] = date.split("-");
        return `${yyyy}-${mm}-${dd}`;
      };

      const formatToDisplay = (date) => {
        const d = new Date(date);
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        return `${dd}-${mm}-${yyyy}`;
      };

      const from = formatDate(fromDate);
      const to = formatDate(toDate);

      /* ================= FETCH USERS ================= */
      const userWhere = {};

      if (section && section !== "All") {
        userWhere.section = section;
      }
      if (day && day !== "All") {
        userWhere.day = day;
      }
      if (areas && areas.length && areas[0] !== "All Areas") {
        userWhere.area = {
          [Op.in]: areas
        };
      }

      const users = await LoanUser.findAll({
        where: userWhere,
        attributes: ["loanId", "sno", "name", "day", "section", "area"],
        order: [["sno", "ASC"]],
        raw: true,
      });

      if (!users.length) {
        return res.status(404).json({
          success: false,
          message: "No users found",
        })
      }

      /* ================= CREATE USER MAP ================= */
      const userMap = {};
      users.forEach((u) => {
        userMap[u.loanId] = u;
      });

      const loanIds = Object.keys(userMap);

      /* ================= FETCH COLLECTIONS ================= */
      const collections = await LoanTable.findAll({
        where: {
          loanId: { [Op.in]: loanIds },
          date: {
            [Op.between]: [from, to],
          },
        },
        order: [["date", "ASC"]],
        raw: true,
      });

      /* ================= EXCEL SETUP ================= */
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Collection Report");

      sheet.columns = [
        { header: "S.No", key: "sno", width: 10 },
        { header: "Name", key: "name", width: 25 },
        { header: "Amount", key: "amount", width: 15 },
        { header: "Date", key: "date", width: 15 },
        { header: "Section", key: "section", width: 15 },
        { header: "Day", key: "day", width: 15 },
        { header: "Area", key: "area", width: 15 },
      ];

      sheet.getRow(1).font = { bold: true };

      /* ================= ADD DATA ================= */
      let total = 0;

      collections.forEach((item) => {
        const user = userMap[item.loanId];
        if (!user) return;

        const amt = Number(item.amount || 0);
        total += amt;

        sheet.addRow({
          sno: user.sno,
          name: user.name,
          amount: amt,
          date: formatToDisplay(item.date),
          section: user.section,   // ✅ add this
          day: user.day,           // ✅ add this
          area: user.area,
        });
      });

      /* ================= TOTAL ROW ================= */
      const totalRow = sheet.addRow({
        name: "TOTAL",
        amount: total,
      });

      totalRow.font = { bold: true };

      /* ================= DOWNLOAD ================= */
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename=collection_report_${Date.now()}.xlsx`
      );

      await workbook.xlsx.write(res);
      res.end();
    }
    if (dataType === "Customer Data") {

      /* ================= DATE FORMAT ================= */
      const formatDate = (date) => {
        const [dd, mm, yyyy] = date.split("-");
        return `${yyyy}-${mm}-${dd}`;
      };

      const formatToDisplay = (date) => {
        const d = new Date(date);
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        return `${dd}-${mm}-${yyyy}`;
      };

      const from = formatDate(fromDate);
      const to = formatDate(toDate);

      /* ================= FILTER ================= */
      const userWhere = {
        givenDate: {
          [Op.between]: [from, to],
        },
      };

      if (section && section !== "All") {
        userWhere.section = section;
      }

      if (day && day !== "All") {
        userWhere.day = day;
      }

      if (areas && areas.length && areas[0] !== "All Areas") {
        userWhere.area = {
          [Op.in]: areas,
        };
      }

      /* ================= FETCH USERS ================= */
      const users = await LoanUser.findAll({
        where: userWhere,
        order: [["sno", "ASC"]],
        raw: true,
      });

      if (!users.length) {
        return res.status(404).json({
          success: false,
          message: "No customer data found",
        });
      }

      /* ================= EXCEL ================= */
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Customer Data");

      sheet.columns = [
        { header: "Loan ID", key: "loanId", width: 40 },
        { header: "S.No", key: "sno", width: 8 },
        { header: "Name", key: "name", width: 20 },
        { header: "Phone", key: "phoneNumber", width: 15 },
        { header: "Alt Number", key: "alternativeNumber", width: 15 },
        { header: "Address", key: "address", width: 25 },
        { header: "Work", key: "work", width: 20 },
        { header: "House Wife / Son Of", key: "houseWifeOrSonOf", width: 20 },
        { header: "Refer Name", key: "referName", width: 20 },
        { header: "Refer Number", key: "referNumber", width: 15 },
        { header: "Section", key: "section", width: 12 },
        { header: "Area", key: "area", width: 15 },
        { header: "Day", key: "day", width: 12 },
        { header: "Given Amount", key: "givenAmount", width: 15 },
        { header: "Paid", key: "paid", width: 12 },
        { header: "Interest %", key: "interestPercent", width: 12 },
        { header: "Interest", key: "interest", width: 12 },
        { header: "Total Amount", key: "tamount", width: 15 },
        { header: "Given Date", key: "givenDate", width: 15 },
        { header: "Last Date", key: "lastDate", width: 15 },
        { header: "Additional Info", key: "additionalInfo", width: 25 },
        { header: "Verified By", key: "verifiedBy", width: 20 },
        { header: "Verified By No", key: "verifiedByNo", width: 20 },
        { header: "Created At", key: "createdAt", width: 20 },
        { header: "Updated At", key: "updatedAt", width: 20 },
      ];
      sheet.getRow(1).font = { bold: true };

      /* ================= ADD DATA ================= */
      let totalGiven = 0;
      let totalPaid = 0;
      let totalAmount = 0;

      users.forEach((u) => {
        totalGiven += Number(u.givenAmount || 0);
        totalPaid += Number(u.paid || 0);
        totalAmount += Number(u.tamount || 0);

        sheet.addRow({
          ...u,
          givenDate: formatToDisplay(u.givenDate),
          lastDate: formatToDisplay(u.lastDate),
          createdAt: u.createdAt ? formatToDisplay(u.createdAt) : "",
          updatedAt: u.updatedAt ? formatToDisplay(u.updatedAt) : "",
        });
      });

      /* ================= TOTAL ROW ================= */
      const totalRow = sheet.addRow({
        name: "TOTAL",
        givenAmount: totalGiven,
        paid: totalPaid,
        tamount: totalAmount,
      });

      totalRow.font = { bold: true };

      /* ================= DOWNLOAD ================= */
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename=customer_data_${Date.now()}.xlsx`
      );

      await workbook.xlsx.write(res);
      return res.end();
    }
    if (dataType === "Full Data") {

      /* ================= DATE FORMAT ================= */
      const formatDate = (date) => {
        const [dd, mm, yyyy] = date.split("-");
        return `${yyyy}-${mm}-${dd}`;
      };

      const formatToDisplay = (date) => {
        const d = new Date(date);
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        return `${dd}-${mm}-${yyyy}`;
      };

      const from = formatDate(fromDate);
      const to = formatDate(toDate);

      /* ================= FILTER USERS ================= */
      const userWhere = {
        givenDate: {
          [Op.between]: [from, to],
        },
      };

      if (section && section !== "All") {
        userWhere.section = section;
      }

      if (day && day !== "All") {
        userWhere.day = day;
      }

      if (areas && areas.length && areas[0] !== "All Areas") {
        userWhere.area = {
          [Op.in]: areas,
        };
      }

      /* ================= FETCH USERS ================= */
      const users = await LoanUser.findAll({
        where: userWhere,
        order: [["sno", "ASC"]],
        raw: true,
      });

      if (!users.length) {
        return res.status(404).json({
          success: false,
          message: "No data found",
        });
      }
      const loanIds = users.map((u) => u.loanId);

      /* ================= FETCH COLLECTIONS ================= */
      const collections = await LoanTable.findAll({
        where: {
          loanId: { [Op.in]: loanIds },
          date: {
            [Op.between]: [from, to],
          },
        },
        order: [["date", "ASC"]],
        raw: true,
      });

      /* ================= GROUP COLLECTIONS ================= */
      const collectionMap = {};
      collections.forEach((c) => {
        if (!collectionMap[c.loanId]) {
          collectionMap[c.loanId] = [];
        }
        collectionMap[c.loanId].push(c);
      });

      /* ================= EXCEL ================= */
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Full Data");

      /* ================= LOOP USERS ================= */
      users.forEach((user) => {

        /* ===== USER HEADER ===== */
        const userHeader = sheet.addRow([
          "Loan ID",
          "S.No",
          "Name",
          "Phone",
          "Alt Number",
          "Address",
          "Work",
          "House Wife / Son Of",
          "Refer Name",
          "Refer Number",
          "Section",
          "Area",
          "Day",
          "Given Amount",
          "Paid",
          "Interest %",
          "Interest",
          "Total Amount",
          "Given Date",
          "Last Date",
          "Additional Info",
          "Verified By",
          "Verified By No",
          "Created At",
          "Updated At"
        ]);
        sheet.getColumn(1).width = 38; // Loan ID
        sheet.getColumn(2).width = 8;  // S.No
        sheet.getColumn(3).width = 20; // Name
        sheet.getColumn(4).width = 15; // Phone
        sheet.getColumn(5).width = 15; // Alt Number
        sheet.getColumn(6).width = 25; // Address
        sheet.getColumn(7).width = 18; // Work
        sheet.getColumn(8).width = 22; // House Wife / Son Of
        sheet.getColumn(9).width = 18; // Refer Name
        sheet.getColumn(10).width = 15; // Refer Number
        sheet.getColumn(11).width = 12; // Section
        sheet.getColumn(12).width = 15; // Area
        sheet.getColumn(13).width = 12; // Day
        sheet.getColumn(14).width = 15; // Given Amount
        sheet.getColumn(15).width = 10; // Paid
        sheet.getColumn(16).width = 12; // Interest %
        sheet.getColumn(17).width = 12; // Interest
        sheet.getColumn(18).width = 15; // Total Amount
        sheet.getColumn(19).width = 15; // Given Date
        sheet.getColumn(20).width = 15; // Last Date
        sheet.getColumn(21).width = 25; // Additional Info
        sheet.getColumn(22).width = 18; // Verified By
        sheet.getColumn(23).width = 18; // Verified By No
        sheet.getColumn(24).width = 20; // Created At
        sheet.getColumn(25).width = 20; // Updated At

        userHeader.font = { bold: true };

        /* ===== USER DATA ===== */
        sheet.addRow([
          user.loanId,
          user.sno,
          user.name,
          user.phoneNumber,
          user.alternativeNumber,
          user.address,
          user.work,
          user.houseWifeOrSonOf,
          user.referName,
          user.referNumber,
          user.section,
          user.area,
          user.day,
          user.givenAmount,
          user.paid,
          user.interestPercent,
          user.interest,
          user.tamount,
          formatToDisplay(user.givenDate),
          formatToDisplay(user.lastDate),
          user.additionalInfo,
          user.verifiedBy,
          user.verifiedByNo,
          user.createdAt ? formatToDisplay(user.createdAt) : "",
          user.updatedAt ? formatToDisplay(user.updatedAt) : ""
        ]);

        sheet.addRow([]); // spacing

        /* ===== COLLECTION HEADER ===== */
        const colHeader = sheet.addRow(["Date", "Collection Amount"]);
        colHeader.font = { bold: true };

        /* ===== COLLECTION DATA ===== */
        const userCollections = collectionMap[user.loanId] || [];
        let userTotal = 0;

        userCollections.forEach((c) => {
          const amt = Number(c.amount || 0);
          userTotal += amt;

          sheet.addRow([
            formatToDisplay(c.date),
            amt
          ]);
        });

        /* ===== USER TOTAL ===== */
        const totalRow = sheet.addRow([
          "TOTAL",
          userTotal
        ]);
        totalRow.font = { bold: true };

        /* ===== SPACE BETWEEN USERS ===== */
        sheet.addRow([]);
        sheet.addRow([]);
      });

      /* ================= DOWNLOAD ================= */
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename=full_data_${Date.now()}.xlsx`
      );

      await workbook.xlsx.write(res);
      return res.end();
    }
  } catch (err) {
    console.log("Error in downloadReport: ", err);
    res.status(500).json({
      success: false,
      message: "Error in downloadReport",
      data: err.message,
    });
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

// 🔹 Toggle Mark (supports single object or array)
const toggleMark = async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];
    const errors = [];

    for (const item of items) {
      const loanId = item.id || req.query.id;

      if (!loanId) {
        errors.push({ id: item.id, message: "Loan ID is required" });
        continue;
      }

      const loan = await LoanUser.findOne({ where: { loanId } });

      if (!loan) {
        errors.push({ id: loanId, message: "Loan not found" });
        continue;
      }

      // Toggle the marked status
      await loan.update({ marked: !loan.marked });
      results.push({ loanId, marked: loan.marked });
    }

    res.status(200).json({
      success: true,
      message: `${results.length} loan(s) marked status updated successfully`,
      data: results.length === 1 ? results[0] : results,
      ...(errors.length > 0 && { errors }),
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
  toggleMark
};
